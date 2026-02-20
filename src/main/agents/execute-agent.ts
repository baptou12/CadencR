/**
 * Execute Agent — orchestrates phase execution in step order with parallel support.
 *
 * Each phase is executed via startUnifiedAgent, while the orchestrator manages
 * step ordering, parallel dispatch, and overall status tracking.
 *
 * Flow:
 * 1. Reads phases from the plan, grouped by step number
 * 2. Executes phases within each step in parallel (via startUnifiedAgent per phase)
 * 3. Updates phase status in DB as each completes
 * 4. Optionally commits after each phase if auto-commit is enabled
 * 5. Updates feature status to "in-progress" when building starts
 */

import { getDatabase } from "../db/database";
import type { PhaseRow, PlanRow, SettingRow } from "../db/types";
import { notifyDbUpdated } from "./ipc-bridge";
import { startUnifiedAgent } from "./unified-agent";
import { EXECUTE_SYSTEM_PROMPT, createQaConfig } from "./agent-configs";
import { createExecuteMcpServer } from "./mcp-tools";
import { broadcast, AGENT_EVENT_CHANNEL } from "./broadcast";
import type { AgentEvent, UnifiedAgentConfig, CompletionAction } from "./types";

export interface ExecuteAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface ExecuteAgentResult {
  /** Subprocess IDs for all launched phase executions */
  subprocessIds: string[];
  sessionDbId: number;
}

/**
 * Start the execute agent for a feature.
 * Executes phases in step order, with parallel execution within each step.
 */
export function startExecuteAgent(options: ExecuteAgentOptions): ExecuteAgentResult {
  const db = getDatabase();

  // Update feature status to in-progress
  db.prepare("UPDATE features SET status = 'in-progress' WHERE id = ?").run(options.featureId);
  notifyDbUpdated("feature", options.featureId);

  // Create orchestrator session record (tracks overall execution)
  const sessionResult = db
    .prepare(
      "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(options.featureId, "execute", "running");
  const sessionDbId = Number(sessionResult.lastInsertRowid);

  // Get the active plan for this feature
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as Pick<PlanRow, "id"> | undefined;

  if (!plan) {
    throw new Error("No active plan found for this feature. Please run the Plan agent first.");
  }

  // Get all pending phases ordered by step_number, then order_index
  const phases = db
    .prepare(
      "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
    )
    .all(plan.id) as PhaseRow[];

  if (phases.length === 0) {
    throw new Error("No pending phases to execute.");
  }

  // Resolve autonomy level: 1 = ask before commit, 2 = manual continue, 3 = full auto
  const autonomyLevel = getAutonomyLevel(options.featureId, options.projectId);

  // Group phases by step number
  const stepGroups = new Map<number, PhaseRow[]>();
  for (const phase of phases) {
    const existing = stepGroups.get(phase.step_number) ?? [];
    existing.push(phase);
    stepGroups.set(phase.step_number, existing);
  }

  // Sort steps in order
  const sortedSteps = Array.from(stepGroups.keys()).toSorted((a, b) => a - b);

  // Launch all phases in the first step immediately so we can return their IDs.
  // Subsequent steps are kicked off after each step completes.
  const firstStepNumber = sortedSteps[0];
  const firstStepPhases = stepGroups.get(firstStepNumber) ?? [];

  const optionsWithSession = { ...options, sessionDbId };
  const firstStepSubprocessIds: string[] = [];
  const firstStepPromises = firstStepPhases.map((phase) =>
    dispatchPhase(phase, optionsWithSession, autonomyLevel, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously after first step completes.
  void (async () => {
    await Promise.allSettled(firstStepPromises);

    const firstStepResult = getStepOutcome(plan.id, firstStepNumber);
    if (firstStepResult !== "ok" && firstStepResult !== "qa_fail_with_fixes") {
      db.prepare(
        "UPDATE agent_sessions SET status = ?, ended_at = datetime('now') WHERE id = ?",
      ).run(firstStepResult === "paused" ? "paused" : "error", sessionDbId);
      if (firstStepResult === "paused") {
        broadcastExecutePaused(sessionDbId);
      } else {
        broadcastExecuteAllDone(sessionDbId, 1);
      }
      return;
    }

    // For Level 2 (manual continue), stop after first step and wait
    if (autonomyLevel === 2 && sortedSteps.length > 1) {
      db.prepare(
        "UPDATE agent_sessions SET status = 'waiting' WHERE id = ?",
      ).run(sessionDbId);
      broadcastExecuteWaiting(sessionDbId, sortedSteps[1]);
      return;
    }

    await executeRemainingSteps(sortedSteps, 1, stepGroups, optionsWithSession, autonomyLevel, plan.id, sessionDbId);
  })();

  return {
    subprocessIds: firstStepSubprocessIds,
    sessionDbId,
  };
}

/**
 * Check step outcome: "ok" if all phases completed, "error" if any errored,
 * "paused" if any were reset to pending (i.e. paused/interrupted).
 * "qa_fail_with_fixes" if a QA phase failed but fix phases were injected.
 */
function getStepOutcome(planId: number, stepNumber: number): "ok" | "error" | "paused" | "qa_fail_with_fixes" {
  const db = getDatabase();
  const errorRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'error'",
    )
    .get(planId, stepNumber) as { cnt: number };

  if (errorRow.cnt > 0) {
    // Check if the errors are only from QA phases that injected fix phases
    const qaErrors = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'error' AND phase_type = 'qa'",
      )
      .get(planId, stepNumber) as { cnt: number };
    const nonQaErrors = errorRow.cnt - qaErrors.cnt;

    if (nonQaErrors > 0) return "error";

    // QA failed — check if fix phases were injected (pending phases with higher step numbers)
    const fixPhases = db
      .prepare(
        "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number > ? AND status = 'pending'",
      )
      .get(planId, stepNumber) as { cnt: number };

    if (fixPhases.cnt > 0) return "qa_fail_with_fixes";
    return "error";
  }

  const pendingRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'pending'",
    )
    .get(planId, stepNumber) as { cnt: number };
  if (pendingRow.cnt > 0) return "paused";

  return "ok";
}


/**
 * Broadcast a synthetic event to the renderer indicating all execute phases are done.
 */
function broadcastExecuteAllDone(sessionDbId: number, exitCode = 0): void {
  const event: AgentEvent = {
    subprocessId: `session-${sessionDbId}`,
    agentType: "execute",
    event: { type: "agent_done", exitCode },
    timestamp: Date.now(),
  };
  broadcast(AGENT_EVENT_CHANNEL, event);
}

/**
 * Broadcast a synthetic event to the renderer indicating the execute orchestrator was paused.
 */
function broadcastExecutePaused(sessionDbId: number): void {
  const event: AgentEvent = {
    subprocessId: `session-${sessionDbId}`,
    agentType: "execute",
    event: { type: "agent_paused" },
    timestamp: Date.now(),
  };
  broadcast(AGENT_EVENT_CHANNEL, event);
}

/**
 * Dispatch a phase to the appropriate executor based on phase_type.
 */
function dispatchPhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions & { sessionDbId: number },
  autonomyLevel: 1 | 2 | 3,
  allSubprocessIds: string[],
): Promise<void> {
  if (phase.phase_type === "qa") {
    return executeQaPhase(phase, options, allSubprocessIds);
  }
  return executePhase(phase, options, autonomyLevel, allSubprocessIds);
}

/**
 * Execute a QA phase by starting the QA agent.
 * Returns a promise that resolves when the QA check completes.
 */
function executeQaPhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions & { sessionDbId: number },
  allSubprocessIds: string[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const db = getDatabase();

    // Update phase status to running
    db.prepare("UPDATE phases SET status = 'running' WHERE id = ?").run(phase.id);
    notifyDbUpdated("phase", options.featureId);

    // Get QA prompt from project settings
    const qaRow = db
      .prepare("SELECT value FROM project_settings WHERE project_id = ? AND key = 'qa_prompt'")
      .get(options.projectId) as { value: string } | undefined;
    const qaPrompt = qaRow?.value || "Run any available tests and verify the implementation works correctly.";

    // Build summary of completed phases
    const completedPhases = db
      .prepare(
        "SELECT step_number, title, implementation_notes FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
      )
      .all(phase.plan_id) as { step_number: number; title: string; implementation_notes: string | null }[];

    const completedPhasesSummary = completedPhases.length > 0
      ? "The following phases have been completed:\n\n" +
        completedPhases
          .map((p) => {
            let entry = `- **Phase (step ${p.step_number}): ${p.title}**`;
            if (p.implementation_notes) entry += `\n  - ${p.implementation_notes}`;
            return entry;
          })
          .join("\n")
      : "No phases have been completed yet.";

    const qaConfig = createQaConfig({
      featureId: options.featureId,
      projectId: options.projectId,
      cwd: options.cwd,
      qaPrompt,
      completedPhasesSummary,
      planId: phase.plan_id,
      qaPhaseStepNumber: phase.step_number,
      worktreePath: options.worktreePath,
    });

    // Override completion actions to also update phase status
    const originalActions = qaConfig.completionActions ?? [];
    qaConfig.completionActions = [
      ...originalActions,
      {
        event: "qa_phase_status",
        handler: (output: string, context) => {
          const db2 = getDatabase();
          const session = db2.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(context.sessionDbId) as { status: string } | undefined;
          const wasInterrupted = session?.status === "paused";

          if (wasInterrupted) {
            db2.prepare("UPDATE phases SET status = 'pending' WHERE id = ? AND status = 'running'").run(phase.id);
          } else if (context.exitCode === 0) {
            // Check if QA passed or failed
            const isFail = /---QA_REPORT_START---[\s\S]*?##\s+Summary\s*\n\s*FAIL/i.test(output);
            db2.prepare("UPDATE phases SET status = ? WHERE id = ?").run(
              isFail ? "error" : "completed",
              phase.id,
            );
          } else {
            db2.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
          }
          notifyDbUpdated("phase", options.featureId);
          resolve();
        },
      },
    ];

    // Set run/phase IDs for the orchestrator
    qaConfig.runId = options.sessionDbId;
    qaConfig.phaseId = phase.id;

    try {
      const result = startUnifiedAgent(qaConfig);
      allSubprocessIds.push(result.subprocessId);
    } catch {
      db.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
      notifyDbUpdated("phase", options.featureId);
      resolve();
    }
  });
}

/**
 * Execute a single phase by starting a unified agent.
 * Returns a promise that resolves when the phase completes.
 */
function executePhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions & { sessionDbId: number },
  autonomyLevel: 1 | 2 | 3,
  allSubprocessIds: string[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const db = getDatabase();

    // Update phase status to running
    db.prepare("UPDATE phases SET status = 'running' WHERE id = ?").run(phase.id);
    notifyDbUpdated("phase", options.featureId);

    // Build enriched prompt with plan-level context and completed phases
    const prompt = buildEnrichedPrompt(phase, autonomyLevel);

    // Build completion actions for this phase
    const phaseAction = buildPhaseCompletionAction(phase.id, options.featureId);
    const completionActions: CompletionAction[] = [
      {
        event: phaseAction.event,
        handler: async (output, context) => {
          await phaseAction.handler(output, context);
          resolve();
        },
      },
    ];

    const mcpServer = createExecuteMcpServer(options.featureId);

    const config: UnifiedAgentConfig = {
      agentType: "execute",
      systemPrompt: EXECUTE_SYSTEM_PROMPT,
      completionActions,
      featureId: options.featureId,
      projectId: options.projectId,
      cwd: options.cwd,
      prompt,
      runId: options.sessionDbId,
      phaseId: phase.id,
      worktreePath: options.worktreePath,
      mcpServers: { "productdevr-execute": mcpServer },
    };

    try {
      const result = startUnifiedAgent(config);
      allSubprocessIds.push(result.subprocessId);
    } catch {
      // Could not start subprocess (e.g., max concurrent limit)
      db.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
      notifyDbUpdated("phase", options.featureId);
      resolve();
    }
  });
}

/**
 * Build an enriched prompt for a phase, including plan-level context and previously completed phases.
 */
function buildEnrichedPrompt(phase: PhaseRow, autonomyLevel: 1 | 2 | 3 = 3): string {
  const db = getDatabase();

  // Fetch plan-level context
  const plan = db
    .prepare(
      "SELECT summary, context, clarifications, completion_conditions FROM plans WHERE id = ?",
    )
    .get(phase.plan_id) as Pick<
    PlanRow,
    "summary" | "context" | "clarifications" | "completion_conditions"
  > | undefined;

  // Fetch previously completed phases (earlier steps only)
  const completedPhases = db
    .prepare(
      "SELECT step_number, title, prompt, implementation_notes, deviations FROM phases WHERE plan_id = ? AND status = 'completed' AND step_number < ? ORDER BY step_number, order_index",
    )
    .all(phase.plan_id, phase.step_number) as Pick<
    PhaseRow,
    "step_number" | "title" | "prompt" | "implementation_notes" | "deviations"
  >[];

  const sections: string[] = [];

  // Plan-level context sections
  if (plan?.summary) {
    sections.push(`## Plan Summary\n\n${plan.summary}`);
  }
  if (plan?.context) {
    sections.push(`## Codebase Context\n\n${plan.context}`);
  }
  if (plan?.clarifications) {
    sections.push(`## Clarifications\n\n${plan.clarifications}`);
  }

  // Previously completed phases
  if (completedPhases.length > 0) {
    const phaseList = completedPhases
      .map((p) => {
        let entry = `- **Phase (step ${p.step_number}): ${p.title}**`;
        if (p.implementation_notes) {
          entry += `\n  - Implementation notes: ${p.implementation_notes}`;
        }
        if (p.deviations) {
          entry += `\n  - Deviations: ${p.deviations}`;
        }
        return entry;
      })
      .join("\n");
    sections.push(
      `## Previously Completed Phases\n\nThe following phases have already been implemented:\n\n${phaseList}`,
    );
  }

  // Completion conditions
  if (plan?.completion_conditions) {
    sections.push(
      `## Completion Conditions\n\n${plan.completion_conditions}\n\nAfter implementing this phase, run each validation command listed above. If any validation fails, analyze the error, fix the issue, and re-run (up to 3 attempts per condition).`,
    );
  }

  // Current phase body
  sections.push(
    `## Current Phase: ${phase.title}\n\nPhase ID: ${phase.id}\n\nExecute the following phase of the implementation plan:\n\n${phase.prompt}\n\nPlease implement all the tasks listed above. Focus only on this phase's scope.\n\nCall \`mark_phase_in_progress\` with phase_id=${phase.id} at the start, and \`mark_phase_done\` with phase_id=${phase.id} when complete.`,
  );

  // Add commit instructions based on autonomy level
  const commitMsg = phase.commit_message ?? "implement phase changes";
  const commitInstructions = `To commit, stage ONLY the files you modified (do NOT use \`git add -A\` or \`git add .\` as other agents may be running in parallel). Use \`git add <file1> <file2> ...\` for each file you changed, then:\n\`\`\`\ngit commit -m ${JSON.stringify(commitMsg)}\n\`\`\``;

  if (autonomyLevel === 1) {
    // Level 1: Ask user for approval, iterate if they request changes
    sections.push(
      `## User Approval Required\n\nAfter outputting your implementation notes and deviations (the ---IMPLEMENTATION_NOTES_START--- block), you MUST ask the user for approval using AskUserQuestion:\n\n- Question: "Review complete. Approve changes and commit?"\n- Options: "Approve and commit", "Skip commit", "Request changes"\n\nIf the user selects "Request changes", they will provide feedback via the "Other" option. In that case:\n1. Read and address their feedback\n2. Make the necessary fixes\n3. Re-output the ---IMPLEMENTATION_NOTES_START--- block with updated notes and deviations\n4. Ask for approval again\n\nIf the user selects "Approve and commit":\n${commitInstructions}\n\nIf the user selects "Skip commit", do NOT commit.\n\nRepeat the approval loop until the user approves or skips. Only output ---AGENT_DONE--- after the user has approved or skipped.`,
    );
  } else {
    // Level 2 & 3: Auto-commit after implementation
    sections.push(
      `## Auto-Commit\n\nAfter outputting your implementation notes and deviations (the ---IMPLEMENTATION_NOTES_START--- block), automatically commit your changes:\n${commitInstructions}\n\nThen output ---AGENT_DONE---.`,
    );
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Get autonomy level: feature → project → global settings cascade.
 * Returns 1 (ask before commit), 2 (manual continue), or 3 (full auto).
 */
function getAutonomyLevel(featureId: number, projectId: number): 1 | 2 | 3 {
  const db = getDatabase();

  // Check feature-level setting first
  const featureRow = db
    .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'agent_autonomy'")
    .get(featureId) as SettingRow | undefined;

  if (featureRow) {
    const val = Number(featureRow.value);
    if (val === 1 || val === 2 || val === 3) return val;
  }

  // Fall back to project-level setting
  const projectRow = db
    .prepare("SELECT value FROM project_settings WHERE project_id = ? AND key = 'agent_autonomy'")
    .get(projectId) as SettingRow | undefined;

  if (projectRow) {
    const val = Number(projectRow.value);
    if (val === 1 || val === 2 || val === 3) return val;
  }

  // Fall back to global setting
  const globalRow = db
    .prepare("SELECT value FROM settings WHERE key = 'agent_autonomy'")
    .get() as SettingRow | undefined;

  if (globalRow) {
    const val = Number(globalRow.value);
    if (val === 1 || val === 2 || val === 3) return val;
  }

  // Default: ask before commit
  return 1;
}

/**
 * Execute remaining steps starting from a given index in the sorted steps array.
 * Shared by both initial launch and continueExecuteAgent.
 *
 * Re-queries phases from DB after each step to pick up fix phases injected by QA.
 */
async function executeRemainingSteps(
  _sortedSteps: number[],
  startIndex: number,
  _stepGroups: Map<number, PhaseRow[]>,
  options: ExecuteAgentOptions & { sessionDbId: number },
  autonomyLevel: 1 | 2 | 3,
  planId: number,
  sessionDbId: number,
): Promise<void> {
  const db = getDatabase();

  // Use the initial sorted steps for the first iteration, then re-query
  let sortedSteps = _sortedSteps;
  let stepGroups = _stepGroups;

  for (let i = startIndex; i < sortedSteps.length; i++) {
    const stepNumber = sortedSteps[i];
    const stepPhases = stepGroups.get(stepNumber) ?? [];
    const stepSubprocessIds: string[] = [];
    const phasePromises = stepPhases.map((phase) =>
      dispatchPhase(phase, options, autonomyLevel, stepSubprocessIds),
    );
    await Promise.allSettled(phasePromises);

    const stepResult = getStepOutcome(planId, stepNumber);
    if (stepResult !== "ok" && stepResult !== "qa_fail_with_fixes") {
      db.prepare(
        "UPDATE agent_sessions SET status = ?, ended_at = datetime('now') WHERE id = ?",
      ).run(stepResult === "paused" ? "paused" : "error", sessionDbId);
      if (stepResult === "paused") {
        broadcastExecutePaused(sessionDbId);
      } else {
        broadcastExecuteAllDone(sessionDbId, 1);
      }
      return;
    }

    // Re-query pending phases from DB (QA may have injected fix phases)
    const pendingPhases = db
      .prepare(
        "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
      )
      .all(planId) as PhaseRow[];

    if (pendingPhases.length === 0) break;

    // Rebuild step groups from fresh data
    stepGroups = new Map<number, PhaseRow[]>();
    for (const phase of pendingPhases) {
      const existing = stepGroups.get(phase.step_number) ?? [];
      existing.push(phase);
      stepGroups.set(phase.step_number, existing);
    }
    sortedSteps = Array.from(stepGroups.keys()).toSorted((a, b) => a - b);
    // Reset index to 0 since we rebuilt the list
    i = -1; // will be incremented to 0 by the for loop

    // For Level 2, stop after each step and wait for user to continue
    if (autonomyLevel === 2) {
      db.prepare(
        "UPDATE agent_sessions SET status = 'waiting' WHERE id = ?",
      ).run(sessionDbId);
      broadcastExecuteWaiting(sessionDbId, sortedSteps[0]);
      return;
    }
  }

  db.prepare(
    "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
  ).run(sessionDbId);

  broadcastExecuteAllDone(sessionDbId, 0);
}

/**
 * Broadcast a synthetic event to the renderer indicating the execute orchestrator is waiting
 * for the user to continue to the next step (Level 2 autonomy).
 */
function broadcastExecuteWaiting(sessionDbId: number, nextStepNumber: number): void {
  const event: AgentEvent = {
    subprocessId: `session-${sessionDbId}`,
    agentType: "execute",
    event: { type: "execute_waiting", nextStepNumber },
    timestamp: Date.now(),
  };
  broadcast(AGENT_EVENT_CHANNEL, event);
}

/**
 * Continue a waiting execute orchestrator by launching the next step's phases.
 * Called from the tRPC `agents.continueExecute` mutation.
 */
export function continueExecuteAgent(sessionDbId: number): { subprocessIds: string[] } {
  const db = getDatabase();

  // Verify the session is in 'waiting' or 'paused' status (paused happens after app restart)
  const session = db
    .prepare("SELECT id, feature_id, status FROM agent_sessions WHERE id = ? AND agent_type = 'execute' AND status IN ('waiting', 'paused')")
    .get(sessionDbId) as { id: number; feature_id: number; status: string } | undefined;

  if (!session) {
    throw new Error("No waiting execute session found");
  }

  // Get feature's project ID
  const feature = db
    .prepare("SELECT project_id FROM features WHERE id = ?")
    .get(session.feature_id) as { project_id: number } | undefined;

  if (!feature) {
    throw new Error("Feature not found");
  }

  // Resolve working directory
  const wtRow = db
    .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
    .get(session.feature_id) as SettingRow | undefined;
  const projectRow = db
    .prepare("SELECT path FROM projects WHERE id = ?")
    .get(feature.project_id) as { path: string } | undefined;
  const cwd = wtRow?.value ?? projectRow?.path;
  if (!cwd) throw new Error("No working directory found");
  const worktreePath = wtRow?.value;

  // Get the active plan
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
    .get(session.feature_id) as { id: number } | undefined;

  if (!plan) throw new Error("No active plan found");

  // Get pending phases
  const phases = db
    .prepare(
      "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
    )
    .all(plan.id) as PhaseRow[];

  if (phases.length === 0) {
    // All phases done — mark session as completed
    db.prepare(
      "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
    ).run(sessionDbId);
    broadcastExecuteAllDone(sessionDbId, 0);
    return { subprocessIds: [] };
  }

  const autonomyLevel = getAutonomyLevel(session.feature_id, feature.project_id);

  // Group remaining phases by step
  const stepGroups = new Map<number, PhaseRow[]>();
  for (const phase of phases) {
    const existing = stepGroups.get(phase.step_number) ?? [];
    existing.push(phase);
    stepGroups.set(phase.step_number, existing);
  }
  const sortedSteps = Array.from(stepGroups.keys()).toSorted((a, b) => a - b);

  // Update session to running
  db.prepare("UPDATE agent_sessions SET status = 'running' WHERE id = ?").run(sessionDbId);

  const options = {
    featureId: session.feature_id,
    projectId: feature.project_id,
    cwd,
    worktreePath,
    sessionDbId,
  };

  // Launch first pending step
  const firstStepNumber = sortedSteps[0];
  const firstStepPhases = stepGroups.get(firstStepNumber) ?? [];
  const firstStepSubprocessIds: string[] = [];
  const firstStepPromises = firstStepPhases.map((phase) =>
    dispatchPhase(phase, options, autonomyLevel, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously
  void (async () => {
    await Promise.allSettled(firstStepPromises);

    const firstStepResult = getStepOutcome(plan.id, firstStepNumber);
    if (firstStepResult !== "ok" && firstStepResult !== "qa_fail_with_fixes") {
      db.prepare(
        "UPDATE agent_sessions SET status = ?, ended_at = datetime('now') WHERE id = ?",
      ).run(firstStepResult === "paused" ? "paused" : "error", sessionDbId);
      if (firstStepResult === "paused") {
        broadcastExecutePaused(sessionDbId);
      } else {
        broadcastExecuteAllDone(sessionDbId, 1);
      }
      return;
    }

    if (sortedSteps.length > 1) {
      // For Level 2, stop after this step
      if (autonomyLevel === 2) {
        db.prepare(
          "UPDATE agent_sessions SET status = 'waiting' WHERE id = ?",
        ).run(sessionDbId);
        broadcastExecuteWaiting(sessionDbId, sortedSteps[1]);
        return;
      }

      await executeRemainingSteps(sortedSteps, 1, stepGroups, options, autonomyLevel, plan.id, sessionDbId);
    } else {
      db.prepare(
        "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
      ).run(sessionDbId);
      broadcastExecuteAllDone(sessionDbId, 0);
    }
  })();

  return { subprocessIds: firstStepSubprocessIds };
}

/**
 * Build a completion action that syncs phase status when an execute agent finishes.
 * Used by both the normal dispatch path and the resume path (router.ts) so that
 * resumed sessions correctly update their phase status.
 */
export function buildPhaseCompletionAction(phaseId: number, featureId: number): CompletionAction {
  return {
    event: "phase_complete",
    handler: async (_output: string, context) => {
      const db2 = getDatabase();

      const session = db2.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(context.sessionDbId) as { status: string } | undefined;
      const wasInterrupted = session?.status === "paused";

      if (wasInterrupted) {
        // Reset to pending if the agent was interrupted
        db2.prepare("UPDATE phases SET status = 'pending' WHERE id = ? AND status = 'running'").run(phaseId);
        notifyDbUpdated("phase", featureId);
      } else if (context.exitCode !== 0) {
        // Agent errored out — mark phase as error (the agent may not have called mark_phase_done)
        db2.prepare("UPDATE phases SET status = 'error' WHERE id = ? AND status = 'running'").run(phaseId);
        notifyDbUpdated("phase", featureId);
      }
      // If exitCode === 0, the agent should have already called mark_phase_done via MCP tool.
      // If it didn't, the phase stays as 'running' which is a signal something went wrong.
    },
  };
}

