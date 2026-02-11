/**
 * Execute Agent — reads plan phases and executes them in step order with parallel support.
 *
 * Flow:
 * 1. Reads phases from the plan, grouped by step number
 * 2. Executes phases within each step in parallel (up to 10 concurrent)
 * 3. Updates phase status in DB as each completes
 * 4. Optionally commits after each phase if auto-commit is enabled
 * 5. Updates feature status to "in-progress" when building starts
 */

import { execSync } from "node:child_process";
import { getDatabase } from "../db/database";
import type { PhaseRow, PlanRow, SettingRow } from "../db/types";
import { startSubprocess, type ManagedSubprocess } from "./subprocess-manager";
import { bridgeSubprocessToRenderer } from "./ipc-bridge";
import type { StreamEvent, StreamContentBlockStart, StreamContentBlockDelta } from "./types";

const EXECUTE_SYSTEM_PROMPT = `You are the Execute agent for ProductDevR, responsible for implementing a single phase of a development plan.

## Your Role

1. **Read** the phase requirements provided in the prompt
2. **Execute** the tasks defined in the phase
3. **Follow** the plan precisely — make the necessary code changes
4. **Keep changes minimal and focused** — don't add extra features or refactoring beyond the task

## Guidelines

### Do:
- Follow the plan precisely
- Match existing code style and conventions
- Make minimal, focused changes
- Apply auto-fixes for type errors, broken imports, missing error handling

### Don't:
- Add features not in the plan
- Refactor unrelated code
- Over-engineer solutions
- Make changes beyond the phase scope

## Important
- Stay focused on the current phase only
- If something is unclear, make a reasonable decision and proceed
- Quality over speed
`;

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

  // Create agent session record
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

  // Launch execution: steps run sequentially, phases within a step run in parallel
  const allSubprocessIds: string[] = [];

  void executeStepsSequentially(sortedSteps, stepGroups, options, sessionDbId, autoCommit, allSubprocessIds);

  return {
    subprocessIds: allSubprocessIds,
    sessionDbId,
  };
}

/**
 * Execute steps sequentially. Within each step, phases run in parallel.
 */
async function executeStepsSequentially(
  steps: number[],
  stepGroups: Map<number, PhaseRow[]>,
  options: ExecuteAgentOptions,
  sessionDbId: number,
  autoCommit: boolean,
  allSubprocessIds: string[],
): Promise<void> {
  const db = getDatabase();

  for (const stepNumber of steps) {
    const phases = stepGroups.get(stepNumber) ?? [];

    // Launch all phases in this step in parallel
    const phasePromises = phases.map((phase) =>
      executePhase(phase, options, autoCommit, allSubprocessIds),
    );

    // Wait for all phases in this step to complete before moving to next step
    await Promise.allSettled(phasePromises);
  }

  // Update session status
  db.prepare(
    "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
  ).run(sessionDbId);
}

/**
 * Execute a single phase by spawning a Claude CLI subprocess.
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

    const prompt = `Execute the following phase of the implementation plan:

${phase.prompt}

Please implement all the tasks listed above. Focus only on this phase's scope.`;

    let managed: ManagedSubprocess;
    try {
      managed = startSubprocess({
        cwd: options.cwd,
        agentType: "execute",
        systemPrompt: EXECUTE_SYSTEM_PROMPT,
        prompt,
      });
    } catch {
      // Could not start subprocess (e.g., max concurrent limit)
      db.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
      resolve();
      return;
    }

    allSubprocessIds.push(managed.id);
    bridgeSubprocessToRenderer(managed, "execute");

    // Collect output for potential commit message
    let fullOutput = "";
    if (managed.process.stdout) {
      managed.process.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as StreamEvent;
            const text = extractTextFromEvent(event);
            if (text) fullOutput += text;
          } catch {
            // Not JSON, skip
          }
        }
      });
    }

    managed.process.on("exit", (code) => {
      if (code === 0) {
        db.prepare("UPDATE phases SET status = 'completed' WHERE id = ?").run(phase.id);

        // Auto-commit if enabled
        if (autoCommit && phase.commit_message) {
          try {
            execSync(`git add -A && git commit -m ${JSON.stringify(phase.commit_message)}`, {
              cwd: options.cwd,
              stdio: "ignore",
            });
          } catch {
            // Commit may fail if no changes — that's OK
          }
        }
      } else {
        db.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
      }

      resolve();
    });

    managed.process.on("error", () => {
      db.prepare("UPDATE phases SET status = 'error' WHERE id = ?").run(phase.id);
      resolve();
    });
  });
}

/**
 * Extract text content from a stream event.
 */
function extractTextFromEvent(event: StreamEvent): string | null {
  if (event.type === "content_block_start") {
    const blockEvent = event as StreamContentBlockStart;
    if (blockEvent.content_block.type === "text") {
      return blockEvent.content_block.text;
    }
  }
  if (event.type === "content_block_delta") {
    const deltaEvent = event as StreamContentBlockDelta;
    if (deltaEvent.delta.type === "text_delta") {
      return deltaEvent.delta.text;
    }
  }
  return null;
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
