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

import { execSync } from "node:child_process";
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

  // Check auto-commit setting
  const autoCommit = getAutoCommitSetting(options.featureId, options.projectId);

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

  const firstStepSubprocessIds: string[] = [];
  const firstStepPromises = firstStepPhases.map((phase) =>
    executePhase(phase, options, autoCommit, firstStepSubprocessIds),
  );

  // Continue remaining steps asynchronously after first step completes.
  void (async () => {
    await Promise.allSettled(firstStepPromises);

    if (hasStepErrors(plan.id, firstStepNumber)) {
      db.prepare(
        "UPDATE agent_sessions SET status = 'error', ended_at = datetime('now') WHERE id = ?",
      ).run(sessionDbId);
      broadcastExecuteAllDone(sessionDbId, 1);
      return;
    }

    for (let i = 1; i < sortedSteps.length; i++) {
      const stepNumber = sortedSteps[i];
      const stepPhases = stepGroups.get(stepNumber) ?? [];
      const stepSubprocessIds: string[] = [];
      const phasePromises = stepPhases.map((phase) =>
        executePhase(phase, options, autoCommit, stepSubprocessIds),
      );
      await Promise.allSettled(phasePromises);

      if (hasStepErrors(plan.id, stepNumber)) {
        db.prepare(
          "UPDATE agent_sessions SET status = 'error', ended_at = datetime('now') WHERE id = ?",
        ).run(sessionDbId);
        broadcastExecuteAllDone(sessionDbId, 1);
        return;
      }
    }

    db.prepare(
      "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
    ).run(sessionDbId);

    broadcastExecuteAllDone(sessionDbId, 0);
  })();

  return {
    subprocessIds: firstStepSubprocessIds,
    sessionDbId,
  };
}

/**
 * Check if any phase in a given step has status 'error'.
 */
function hasStepErrors(planId: number, stepNumber: number): boolean {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND step_number = ? AND status = 'error'",
    )
    .get(planId, stepNumber) as { cnt: number };
  return row.cnt > 0;
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
 * Execute a single phase by starting a unified agent.
 * Returns a promise that resolves when the phase completes.
 */
function executePhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions,
  autoCommit: boolean,
  allSubprocessIds: string[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const db = getDatabase();

    // Update phase status to running
    db.prepare("UPDATE phases SET status = 'running' WHERE id = ?").run(phase.id);
    notifyDbUpdated("phase", options.featureId);

    // Build enriched prompt with plan-level context and completed phases
    const prompt = buildEnrichedPrompt(phase);

    // Build completion actions for this phase
    const completionActions: CompletionAction[] = [
      {
        event: "phase_complete",
        handler: (_output: string, context) => {
          const db2 = getDatabase();

          if (context.exitCode === 0) {
            db2.prepare("UPDATE phases SET status = 'completed' WHERE id = ?").run(phase.id);
            notifyDbUpdated("phase", options.featureId);

            // Auto-commit if enabled
            if (autoCommit && phase.commit_message) {
              try {
                execSync(`git add -A && git commit -m ${JSON.stringify(phase.commit_message)}`, {
                  cwd: options.cwd,
                  stdio: "ignore",
                });
              } catch {
                // Commit may fail if no changes -- that's OK
              }
            }
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
function buildEnrichedPrompt(phase: PhaseRow): string {
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
      "SELECT step_number, title, prompt FROM phases WHERE plan_id = ? AND status = 'completed' AND step_number < ? ORDER BY step_number, order_index",
    )
    .all(phase.plan_id, phase.step_number) as Pick<
    PhaseRow,
    "step_number" | "title" | "prompt"
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
      .map((p) => `- **Phase (step ${p.step_number}): ${p.title}**`)
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

  return sections.join("\n\n---\n\n");
}

/**
 * Get auto-commit setting: feature-level overrides project-level.
 */
function getAutoCommitSetting(featureId: number, projectId: number): boolean {
  const db = getDatabase();

  // Check feature-level setting first
  const featureRow = db
    .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'auto_commit'")
    .get(featureId) as SettingRow | undefined;

  if (featureRow) {
    return featureRow.value === "true";
  }

  // Fall back to project-level setting
  const projectRow = db
    .prepare("SELECT value FROM project_settings WHERE project_id = ? AND key = 'auto_commit'")
    .get(projectId) as SettingRow | undefined;

  if (projectRow) {
    return projectRow.value === "true";
  }

  // Default: no auto-commit
  return false;
}
