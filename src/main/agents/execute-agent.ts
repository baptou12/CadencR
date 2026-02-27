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
import { resolveSetting } from "../db/settings";
import type { PhaseRow, PlanRow, SettingRow } from "../db/types";
import { transitionFeature, transitionPhase, transitionPhaseIf, transitionAgentSession } from "./state-transitions";
import { startUnifiedAgent } from "./unified-agent";
import { buildExecuteSystemPrompt, createQaConfig } from "./agent-configs";
import { buildMcpServerFactory } from "./mcp-factory";
import { broadcast, AGENT_EVENT_CHANNEL } from "./broadcast";
import type { AgentEvent, UnifiedAgentConfig, CompletionAction } from "./types";

/** Maximum number of concurrent agents per feature */
const MAX_AGENTS_PER_FEATURE = 3;

/**
 * Simple concurrency limiter — runs up to `limit` tasks at a time from the
 * provided array of thunks, returning when all have settled.
 */
async function runWithConcurrencyLimit<T>(
  limit: number,
  tasks: Array<() => Promise<T>>,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = Array.from<PromiseSettledResult<T>>({ length: tasks.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      try {
        const value = await tasks[idx]();
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

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
  transitionFeature(db, options.featureId, "in-progress");

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
  const concurrencyLimit = getConcurrencyLimit(options.featureId, options.projectId);

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
  const firstStepTasks = firstStepPhases.map((phase) =>
    () => dispatchPhase(phase, optionsWithSession, autonomyLevel, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously after first step completes.
  void (async () => {
    await runWithConcurrencyLimit(concurrencyLimit, firstStepTasks);

    const firstStepResult = getStepOutcome(plan.id, firstStepNumber);
    if (firstStepResult !== "ok" && firstStepResult !== "qa_fail_with_fixes") {
      const status = firstStepResult === "paused" ? "paused" : "error";
      transitionAgentSession(db, sessionDbId, status, options.featureId, { ended_at: new Date().toISOString() });
      if (firstStepResult === "paused") {
        broadcastExecutePaused(sessionDbId);
      } else {
        broadcastExecuteAllDone(sessionDbId, 1);
      }
      return;
    }

    // For Level 2 (manual continue), stop after first step and wait
    if (autonomyLevel === 2 && sortedSteps.length > 1) {
      transitionAgentSession(db, sessionDbId, "waiting", options.featureId);
      broadcastExecuteWaiting(sessionDbId, sortedSteps[1]);
      return;
    }

    await executeRemainingSteps(sortedSteps, 1, stepGroups, optionsWithSession, autonomyLevel, plan.id, sessionDbId, concurrencyLimit);
  })().catch((err) => {
    console.error(`[orchestrator] Unhandled error in execute orchestrator ${sessionDbId}:`, err);
    try {
      transitionAgentSession(db, sessionDbId, "error", options.featureId, { ended_at: new Date().toISOString() });
      broadcastExecuteAllDone(sessionDbId, 1);
    } catch { /* best effort */ }
  });

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

  if (errorRow.cnt > 0) return "error";

  // A phase still running means something went wrong (e.g., agent died without cleanup)
  const runningRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'running'",
    )
    .get(planId, stepNumber) as { cnt: number };
  if (runningRow.cnt > 0) return "error";

  const pendingRow = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'pending'",
    )
    .get(planId, stepNumber) as { cnt: number };
  if (pendingRow.cnt > 0) return "paused";

  // All phases in this step completed — check if a QA phase injected fix phases
  const fixPhases = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number > ? AND status IN ('pending', 'draft')",
    )
    .get(planId, stepNumber) as { cnt: number };

  if (fixPhases.cnt > 0) return "qa_fail_with_fixes";

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
  // Safety guard: no running phases from a different step should exist
  const db = getDatabase();
  const runningFromOtherStep = db
    .prepare("SELECT id, step_number, phase_type FROM phases WHERE plan_id = ? AND status = 'running' AND step_number != ?")
    .all(phase.plan_id, phase.step_number) as Array<{ id: number; step_number: number; phase_type: string }>;
  if (runningFromOtherStep.length > 0) {
    console.warn(
      `[orchestrator-guard] Attempting to dispatch phase ${phase.id} (step ${phase.step_number}, type ${phase.phase_type}) ` +
      `but ${runningFromOtherStep.length} phase(s) from other steps are still running: ` +
      runningFromOtherStep.map((p) => `phase ${p.id} (step ${p.step_number}, type ${p.phase_type})`).join(", "),
    );
  }

  if (phase.phase_type === "qa") {
    return executeQaPhase(phase, options, autonomyLevel, allSubprocessIds);
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
  autonomyLevel: 1 | 2 | 3,
  allSubprocessIds: string[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const db = getDatabase();

    // Update phase status to running
    transitionPhase(db, phase.id, "running", options.featureId);

    // Get QA prompt from project column
    const qaRow = db
      .prepare("SELECT qa_prompt FROM projects WHERE id = ?")
      .get(options.projectId) as { qa_prompt: string | null } | undefined;
    const qaPrompt = qaRow?.qa_prompt || "Run any available tests and verify the implementation works correctly.";

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
      phaseId: phase.id,
      qaPhaseStepNumber: phase.step_number,
      worktreePath: options.worktreePath,
      autonomyLevel,
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
          const phaseRow = db2.prepare("SELECT status FROM phases WHERE id = ?").get(phase.id) as { status: string } | undefined;
          const wasInterrupted = session?.status === "paused";

          console.log(`[qa-phase-trace] qa_phase_status handler: phase ${phase.id}, sessionDbId=${context.sessionDbId}, sessionStatus=${session?.status}, phaseStatus=${phaseRow?.status}, exitCode=${context.exitCode}, wasInterrupted=${wasInterrupted}`);

          if (wasInterrupted) {
            // Agent was paused — reset phase so it can be re-dispatched
            transitionPhaseIf(db2, phase.id, "running", "pending", options.featureId);
          } else if (phaseRow?.status === "running") {
            // Agent exited without calling mark_phase_done — safety net
            if (context.exitCode !== 0) {
              transitionPhaseIf(db2, phase.id, "running", "error", options.featureId);
            }
            // exitCode === 0 but no mark_phase_done: stays running (user can resume)
          }
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
      transitionPhase(db, phase.id, "error", options.featureId);
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
    transitionPhase(db, phase.id, "running", options.featureId);

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

    const config: UnifiedAgentConfig = {
      agentType: "execute",
      systemPrompt: buildExecuteSystemPrompt(autonomyLevel),
      completionActions,
      featureId: options.featureId,
      projectId: options.projectId,
      cwd: options.cwd,
      prompt,
      runId: options.sessionDbId,
      phaseId: phase.id,
      worktreePath: options.worktreePath,
      mcpServerFactory: buildMcpServerFactory("execute", options.featureId),
    };

    try {
      const result = startUnifiedAgent(config);
      allSubprocessIds.push(result.subprocessId);
    } catch {
      // Could not start subprocess (e.g., max concurrent limit)
      transitionPhase(db, phase.id, "error", options.featureId);
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

  // Fetch previously completed phase titles only (earlier steps)
  const completedPhases = db
    .prepare(
      "SELECT step_number, title FROM phases WHERE plan_id = ? AND status = 'completed' AND step_number < ? ORDER BY step_number, order_index",
    )
    .all(phase.plan_id, phase.step_number) as Pick<
    PhaseRow,
    "step_number" | "title"
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

  // Previously completed phases (titles only — use read_phase MCP tool for details if needed)
  if (completedPhases.length > 0) {
    const phaseList = completedPhases
      .map((p) => `- Step ${p.step_number}: ${p.title}`)
      .join("\n");
    sections.push(
      `## Previously Completed Phases\n\nThe following phases have already been implemented. Use the \`read_phase\` tool if you need details about a specific phase.\n\n${phaseList}`,
    );
  }

  // Current phase body
  sections.push(
    `## Current Phase: ${phase.title}\n\nPhase ID: ${phase.id}\n\n${phase.prompt}\n\nFocus only on this phase's scope. Call \`mark_phase_done\` with phase_id=${phase.id} when complete.`,
  );

  // Add commit instructions based on autonomy level
  const commitMsg = phase.commit_message ?? "implement phase changes";
  const commitInstructions = `To commit, stage ONLY the files you modified (do NOT use \`git add -A\` or \`git add .\` as other agents may be running in parallel). Use \`git add <file1> <file2> ...\` for each file you changed, then:\n\`\`\`\ngit commit -m ${JSON.stringify(commitMsg)}\n\`\`\``;

  if (autonomyLevel === 1) {
    // Level 1: Ask user for approval, iterate if they request changes
    sections.push(
      `## User Approval Required\n\nAfter outputting your implementation notes and deviations, you MUST ask the user for approval using AskUserQuestion:\n\n- Question: "Review complete. Approve changes and commit?"\n- Options: "Approve and commit", "Skip commit", "Request changes"\n\nIf the user selects "Request changes", they will provide feedback via the "Other" option. In that case:\n1. Read and address their feedback\n2. Make the necessary fixes\n3. Re-output your updated implementation notes and deviations\n4. Ask for approval again\n\nIf the user selects "Approve and commit":\n${commitInstructions}\n\nThen call \`mark_phase_done\` with your implementation notes and deviations.\n\n**Do NOT call \`mark_phase_done\` until after approval and successful commit.**\n\nIf the user selects "Skip commit", do NOT commit.\n\nRepeat the approval loop until the user approves or skips. Only call \`mark_agent_done\` after the user has approved or skipped.`,
    );
  } else {
    // Level 2 & 3: Auto-commit after implementation, then mark done
    sections.push(
      `## Auto-Commit\n\nAfter completing your implementation, automatically commit your changes:\n${commitInstructions}\n\nAfter committing, call \`mark_phase_done\` with your implementation notes and deviations. **Do NOT call \`mark_phase_done\` before committing.**\n\nThen call \`mark_agent_done\`.`,
    );
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Get autonomy level: feature → project → global settings cascade.
 * Returns 1 (ask before commit), 2 (manual continue), or 3 (full auto).
 */
export function getAutonomyLevel(featureId: number, projectId: number): 1 | 2 | 3 {
  const raw = resolveSetting("agent_autonomy", { featureId, projectId, defaultValue: "1" });
  const val = Number(raw);
  if (val === 1 || val === 2 || val === 3) return val;
  return 1;
}

/**
 * Check if parallel execution is enabled: feature → project → global settings cascade.
 * Returns the concurrency limit (MAX_AGENTS_PER_FEATURE when enabled, 1 when disabled).
 */
function getConcurrencyLimit(featureId: number, projectId: number): number {
  const raw = resolveSetting("parallel_execution", { featureId, projectId, defaultValue: "true" });
  return raw === "false" ? 1 : MAX_AGENTS_PER_FEATURE;
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
  concurrencyLimit: number = MAX_AGENTS_PER_FEATURE,
): Promise<void> {
  const db = getDatabase();

  // Use the initial sorted steps for the first iteration, then re-query
  let sortedSteps = _sortedSteps;
  let stepGroups = _stepGroups;

  for (let i = startIndex; i < sortedSteps.length; i++) {
    const stepNumber = sortedSteps[i];
    const stepPhases = stepGroups.get(stepNumber) ?? [];
    const stepSubprocessIds: string[] = [];
    const phaseTasks = stepPhases.map((phase) =>
      () => dispatchPhase(phase, options, autonomyLevel, stepSubprocessIds),
    );
    await runWithConcurrencyLimit(concurrencyLimit, phaseTasks);

    const stepResult = getStepOutcome(planId, stepNumber);
    if (stepResult !== "ok" && stepResult !== "qa_fail_with_fixes") {
      const status = stepResult === "paused" ? "paused" : "error";
      transitionAgentSession(db, sessionDbId, status, undefined, { ended_at: new Date().toISOString() });
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
      transitionAgentSession(db, sessionDbId, "waiting");
      broadcastExecuteWaiting(sessionDbId, sortedSteps[0]);
      return;
    }
  }

  // Safety check: verify no pending/draft phases remain before completing
  const remaining = db.prepare(
    "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status IN ('pending', 'draft')",
  ).get(planId) as { cnt: number };

  if (remaining.cnt > 0) {
    // Re-query and continue instead of completing
    const freshPhases = db
      .prepare(
        "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
      )
      .all(planId) as PhaseRow[];

    if (freshPhases.length > 0) {
      const freshGroups = new Map<number, PhaseRow[]>();
      for (const phase of freshPhases) {
        const existing = freshGroups.get(phase.step_number) ?? [];
        existing.push(phase);
        freshGroups.set(phase.step_number, existing);
      }
      const freshSteps = Array.from(freshGroups.keys()).toSorted((a, b) => a - b);
      await executeRemainingSteps(freshSteps, 0, freshGroups, options, autonomyLevel, planId, sessionDbId, concurrencyLimit);
      return;
    }
  }

  transitionAgentSession(db, sessionDbId, "completed", undefined, { ended_at: new Date().toISOString() });

  broadcastExecuteAllDone(sessionDbId, 0);

  // Advance workflow if active
  const wfFeat = db.prepare("SELECT workflow_step FROM features WHERE id = ?")
    .get(options.featureId) as { workflow_step: string | null } | undefined;
  if (wfFeat?.workflow_step === "execute") {
    try { const { advanceWorkflow } = require("./workflow-orchestrator"); advanceWorkflow(options.featureId); } catch { /* */ }
  }
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
    transitionAgentSession(db, sessionDbId, "completed", session.feature_id, { ended_at: new Date().toISOString() });
    broadcastExecuteAllDone(sessionDbId, 0);

    // Advance workflow if active
    const wfFeat2 = db.prepare("SELECT workflow_step FROM features WHERE id = ?")
      .get(session.feature_id) as { workflow_step: string | null } | undefined;
    if (wfFeat2?.workflow_step === "execute") {
      try { const { advanceWorkflow } = require("./workflow-orchestrator"); advanceWorkflow(session.feature_id); } catch { /* */ }
    }

    return { subprocessIds: [] };
  }

  const autonomyLevel = getAutonomyLevel(session.feature_id, feature.project_id);
  const concurrencyLimit = getConcurrencyLimit(session.feature_id, feature.project_id);

  // Group remaining phases by step
  const stepGroups = new Map<number, PhaseRow[]>();
  for (const phase of phases) {
    const existing = stepGroups.get(phase.step_number) ?? [];
    existing.push(phase);
    stepGroups.set(phase.step_number, existing);
  }
  const sortedSteps = Array.from(stepGroups.keys()).toSorted((a, b) => a - b);

  // Update session to running
  transitionAgentSession(db, sessionDbId, "running", session.feature_id);

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
  const firstStepTasks = firstStepPhases.map((phase) =>
    () => dispatchPhase(phase, options, autonomyLevel, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously
  void (async () => {
    await runWithConcurrencyLimit(concurrencyLimit, firstStepTasks);

    const firstStepResult = getStepOutcome(plan.id, firstStepNumber);
    if (firstStepResult !== "ok" && firstStepResult !== "qa_fail_with_fixes") {
      const status = firstStepResult === "paused" ? "paused" : "error";
      transitionAgentSession(db, sessionDbId, status, session.feature_id, { ended_at: new Date().toISOString() });
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
        transitionAgentSession(db, sessionDbId, "waiting", session.feature_id);
        broadcastExecuteWaiting(sessionDbId, sortedSteps[1]);
        return;
      }

      await executeRemainingSteps(sortedSteps, 1, stepGroups, options, autonomyLevel, plan.id, sessionDbId, concurrencyLimit);
    } else {
      // Safety check: verify no pending/draft phases remain
      const remaining = db.prepare(
        "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status IN ('pending', 'draft')",
      ).get(plan.id) as { cnt: number };

      if (remaining.cnt > 0) {
        // Re-query and continue
        const freshPhases = db
          .prepare(
            "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type FROM phases WHERE plan_id = ? AND status IN ('pending', 'error') ORDER BY step_number, order_index",
          )
          .all(plan.id) as PhaseRow[];

        if (freshPhases.length > 0) {
          const freshGroups = new Map<number, PhaseRow[]>();
          for (const phase of freshPhases) {
            const existing = freshGroups.get(phase.step_number) ?? [];
            existing.push(phase);
            freshGroups.set(phase.step_number, existing);
          }
          const freshSteps = Array.from(freshGroups.keys()).toSorted((a, b) => a - b);
          await executeRemainingSteps(freshSteps, 0, freshGroups, options, autonomyLevel, plan.id, sessionDbId, concurrencyLimit);
          return;
        }
      }

      transitionAgentSession(db, sessionDbId, "completed", session.feature_id, { ended_at: new Date().toISOString() });
      broadcastExecuteAllDone(sessionDbId, 0);

      // Advance workflow if active
      const wfFeat3 = db.prepare("SELECT workflow_step FROM features WHERE id = ?")
        .get(session.feature_id) as { workflow_step: string | null } | undefined;
      if (wfFeat3?.workflow_step === "execute") {
        try { const { advanceWorkflow } = require("./workflow-orchestrator"); advanceWorkflow(session.feature_id); } catch { /* */ }
      }
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
      const phaseRow = db2.prepare("SELECT status FROM phases WHERE id = ?").get(phaseId) as { status: string } | undefined;
      const wasInterrupted = session?.status === "paused";

      console.log(`[exec-phase-trace] phase_complete handler: phase ${phaseId}, sessionDbId=${context.sessionDbId}, sessionStatus=${session?.status}, phaseStatus=${phaseRow?.status}, exitCode=${context.exitCode}, wasInterrupted=${wasInterrupted}`);

      if (wasInterrupted) {
        // Reset to pending if the agent was interrupted
        transitionPhaseIf(db2, phaseId, "running", "pending", featureId);
      } else if (context.exitCode !== 0) {
        // Agent errored out — mark phase as error (the agent may not have called mark_phase_done)
        transitionPhaseIf(db2, phaseId, "running", "error", featureId);
      }
      // If exitCode === 0 but mark_phase_done wasn't called, the phase stays 'running'.
      // The user can resume the agent from the UI to let it finish and call mark_phase_done.
    },
  };
}

