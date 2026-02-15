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
import { EXECUTE_SYSTEM_PROMPT } from "./agent-configs";
import type { AgentEvent, UnifiedAgentConfig, CompletionAction } from "./types";

export interface ExecuteAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
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
      "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
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
    executePhase(phase, optionsWithSession, autonomyLevel, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously after first step completes.
  void (async () => {
    await Promise.allSettled(firstStepPromises);

    const firstStepResult = getStepOutcome(plan.id, firstStepNumber);
    if (firstStepResult !== "ok") {
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
 */
function getStepOutcome(planId: number, stepNumber: number): "ok" | "error" | "paused" {
  const db = getDatabase();
  const errorRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'error'",
    )
    .get(planId, stepNumber) as { cnt: number };
  if (errorRow.cnt > 0) return "error";

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
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const event: AgentEvent = {
    subprocessId: `session-${sessionDbId}`,
    agentType: "execute",
    event: { type: "agent_done", exitCode },
    timestamp: Date.now(),
  };
  const AGENT_EVENT_CHANNEL = "agent:event";
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(AGENT_EVENT_CHANNEL, event);
    }
  }
}

/**
 * Broadcast a synthetic event to the renderer indicating the execute orchestrator was paused.
 */
function broadcastExecutePaused(sessionDbId: number): void {
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const event: AgentEvent = {
    subprocessId: `session-${sessionDbId}`,
    agentType: "execute",
    event: { type: "agent_paused" },
    timestamp: Date.now(),
  };
  const AGENT_EVENT_CHANNEL = "agent:event";
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(AGENT_EVENT_CHANNEL, event);
    }
  }
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
    const completionActions: CompletionAction[] = [
      {
        event: "phase_complete",
        handler: async (_output: string, context) => {
          const db2 = getDatabase();

          // Check if the session was interrupted — if so, don't update the
          // phase status (it stays 'running' or whatever it was).
          const session = db2.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(context.sessionDbId) as { status: string } | undefined;
          const wasInterrupted = session?.status === "paused";

          if (wasInterrupted) {
            // Reset phase from 'running' to 'pending' so it can be re-executed
            db2.prepare("UPDATE phases SET status = 'pending' WHERE id = ? AND status = 'running'").run(phase.id);
            notifyDbUpdated("phase", options.featureId);
          } else if (context.exitCode === 0) {
            // Parse implementation notes and deviations from agent output
            const parsed = parsePhaseOutput(_output);
            db2.prepare(
              "UPDATE phases SET status = 'completed', implementation_notes = ?, deviations = ? WHERE id = ?",
            ).run(parsed.implementationNotes, parsed.deviations, phase.id);
            notifyDbUpdated("phase", options.featureId);

            // Commits are handled by the agent subprocess itself (via prompt instructions)
            // Level 1: agent asks user, commits if approved
            // Level 2 & 3: agent auto-commits as part of its execution
          } else {
            db2.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
            notifyDbUpdated("phase", options.featureId);
          }

          resolve();
        },
      },
    ];

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
    `## Current Phase: ${phase.title}\n\nExecute the following phase of the implementation plan:\n\n${phase.prompt}\n\nPlease implement all the tasks listed above. Focus only on this phase's scope.`,
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
 */
async function executeRemainingSteps(
  sortedSteps: number[],
  startIndex: number,
  stepGroups: Map<number, PhaseRow[]>,
  options: ExecuteAgentOptions & { sessionDbId: number },
  autonomyLevel: 1 | 2 | 3,
  planId: number,
  sessionDbId: number,
): Promise<void> {
  const db = getDatabase();

  for (let i = startIndex; i < sortedSteps.length; i++) {
    const stepNumber = sortedSteps[i];
    const stepPhases = stepGroups.get(stepNumber) ?? [];
    const stepSubprocessIds: string[] = [];
    const phasePromises = stepPhases.map((phase) =>
      executePhase(phase, options, autonomyLevel, stepSubprocessIds),
    );
    await Promise.allSettled(phasePromises);

    const stepResult = getStepOutcome(planId, stepNumber);
    if (stepResult !== "ok") {
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

    // For Level 2, stop after each step and wait for user to continue
    if (autonomyLevel === 2 && i < sortedSteps.length - 1) {
      db.prepare(
        "UPDATE agent_sessions SET status = 'waiting' WHERE id = ?",
      ).run(sessionDbId);
      broadcastExecuteWaiting(sessionDbId, sortedSteps[i + 1]);
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
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const event: AgentEvent = {
    subprocessId: `session-${sessionDbId}`,
    agentType: "execute",
    event: { type: "execute_waiting", nextStepNumber },
    timestamp: Date.now(),
  };
  const AGENT_EVENT_CHANNEL = "agent:event";
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(AGENT_EVENT_CHANNEL, event);
    }
  }
}

/**
 * Continue a waiting execute orchestrator by launching the next step's phases.
 * Called from the tRPC `agents.continueExecute` mutation.
 */
export function continueExecuteAgent(sessionDbId: number): { subprocessIds: string[] } {
  const db = getDatabase();

  // Verify the session is in 'waiting' status
  const session = db
    .prepare("SELECT id, feature_id, status FROM agent_sessions WHERE id = ? AND agent_type = 'execute' AND status = 'waiting'")
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

  // Get the active plan
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
    .get(session.feature_id) as { id: number } | undefined;

  if (!plan) throw new Error("No active plan found");

  // Get pending phases
  const phases = db
    .prepare(
      "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
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
    sessionDbId,
  };

  // Launch first pending step
  const firstStepNumber = sortedSteps[0];
  const firstStepPhases = stepGroups.get(firstStepNumber) ?? [];
  const firstStepSubprocessIds: string[] = [];
  const firstStepPromises = firstStepPhases.map((phase) =>
    executePhase(phase, options, autonomyLevel, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously
  void (async () => {
    await Promise.allSettled(firstStepPromises);

    const firstStepResult = getStepOutcome(plan.id, firstStepNumber);
    if (firstStepResult !== "ok") {
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
 * Parse implementation notes and deviations from the agent's accumulated output.
 * Looks for content between ---IMPLEMENTATION_NOTES_START--- and ---IMPLEMENTATION_NOTES_END--- delimiters,
 * then extracts ## Implementation Notes and ## Deviations sections.
 */
function parsePhaseOutput(output: string): {
  implementationNotes: string | null;
  deviations: string | null;
} {
  const startDelim = "---IMPLEMENTATION_NOTES_START---";
  const endDelim = "---IMPLEMENTATION_NOTES_END---";

  const startIdx = output.lastIndexOf(startDelim);
  if (startIdx === -1) {
    return { implementationNotes: null, deviations: null };
  }

  const endIdx = output.indexOf(endDelim, startIdx);
  const block = endIdx === -1
    ? output.slice(startIdx + startDelim.length)
    : output.slice(startIdx + startDelim.length, endIdx);

  const extractSection = (heading: string): string | null => {
    const pattern = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = block.match(pattern);
    return match ? match[1].trim() || null : null;
  };

  return {
    implementationNotes: extractSection("Implementation Notes"),
    deviations: extractSection("Deviations"),
  };
}
