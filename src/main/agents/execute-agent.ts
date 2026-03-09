/**
 * Execute Agent — queue-based phase execution via processNextPhase.
 *
 * Single entry point: processNextPhase() picks the next pending phase,
 * dispatches it, and on completion calls processNextPhase again.
 * When no phases remain, triggers review. After review, if no fix
 * phases exist, marks the feature done.
 */

import { Effect } from "effect";
import { getDatabase } from "../db/database";
import { queryOne, queryAllValidated } from "../db/query";
import { resolveSetting } from "../db/settings";
import { getAutonomyLevel } from "./autonomy";
import type { PhaseRow, PlanRow } from "../db/types";
import { PhaseRowSchema } from "../effect/schemas/db-schemas";
import { transitionFeature, transitionPhase, transitionPhaseIf } from "./state-transitions";
import { startUnifiedAgent } from "./unified-agent";
import { buildExecuteSystemPrompt, createQaConfig } from "./agent-configs";
import { buildMcpServerFactory } from "./mcp-factory";
import { notifyDbUpdated } from "./session-persistence";
import { startReviewAgent } from "./agent-starters";
import type { OnAgentDoneCallback } from "./mcp-tools";
import type { UnifiedAgentConfig, CompletionAction } from "./types";

/** Callback adapter that bridges OnAgentDoneCallback to processNextPhase */
const processNextPhaseCallback: OnAgentDoneCallback = (opts) => {
  processNextPhase({ featureId: opts.featureId, projectId: opts.projectId, cwd: opts.cwd, worktreePath: opts.worktreePath ?? undefined });
};

/** Maximum number of concurrent agents per feature */
const MAX_AGENTS_PER_FEATURE = 3;

export interface ExecuteAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

/** In-memory lock to prevent concurrent processNextPhase for the same feature */
const dispatchingFeatures = new Set<number>();

/**
 * Queue-based executor: pick next pending phase, run it, chain on completion.
 *
 * Idempotent — safe to call multiple times for the same feature. Returns
 * immediately if agents are already running or no work remains.
 */
export function processNextPhase(options: ExecuteAgentOptions): void {
  const { featureId, projectId } = options;

  // In-memory lock: prevent concurrent dispatch for the same feature
  if (dispatchingFeatures.has(featureId)) return;
  dispatchingFeatures.add(featureId);

  try {
    // 1. Ensure feature is in-progress
    const featureRow = Effect.runSync(queryOne<{ status: string }>(
      "SELECT status FROM features WHERE id = ?",
      featureId,
    ));
    const featureStatus = featureRow?.status ?? "draft";

    if (featureStatus !== "in-progress" && featureStatus !== "planned") return;

    // Transition to in-progress if planned
    if (featureStatus === "planned") {
      transitionFeature(getDatabase(), featureId, "in-progress");
    }

    // 2. Get active plan
    const plan = Effect.runSync(queryOne<Pick<PlanRow, "id">>(
      "SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
      featureId,
    ));
    if (plan === null) return;
    const planId = plan.id;

    // 3. Idempotent guard: don't start if execute/qa agents are already running
    const hasRunningAgent = Effect.runSync(queryOne<{ id: number }>(
      "SELECT id FROM agent_sessions WHERE feature_id = ? AND agent_type IN ('execute', 'qa') AND status = 'running' LIMIT 1",
      featureId,
    )) !== null;
    if (hasRunningAgent) return;

    // 4. Find lowest step_number with pending/error phases (excluding phases
    //    that already have a running or paused agent session — those need manual resume)
    const pendingPhases = Effect.runSync(queryAllValidated(
      PhaseRowSchema,
      `SELECT *
       FROM phases
       WHERE plan_id = ? AND status IN ('pending', 'error')
         AND id NOT IN (
           SELECT phase_id FROM agent_sessions
           WHERE feature_id = ? AND phase_id IS NOT NULL AND status IN ('running', 'paused')
         )
       ORDER BY step_number, order_index`,
      planId, featureId,
    ));

    if (pendingPhases.length > 0) {
      // 5. Get all phases from the lowest step_number
      const firstStepNumber = pendingPhases[0].step_number;
      const stepPhases = pendingPhases.filter((p) => p.step_number === firstStepNumber);

      const autonomyLevel = getAutonomyLevel(featureId, projectId);
      const concurrencyLimit = getConcurrencyLimit(featureId, projectId);

      // Level 2 autonomy: check if we should pause (a step already completed since last user action)
      if (autonomyLevel === 2) {
        const lastCompleted = Effect.runSync(queryOne<{ id: number }>(
          "SELECT id FROM agent_sessions WHERE feature_id = ? AND agent_type IN ('execute', 'qa') AND status = 'completed' ORDER BY id DESC LIMIT 1",
          featureId,
        ));
        if (lastCompleted !== null) {
          console.log(`[processNextPhase] Level 2 autonomy: pausing for feature ${featureId}, waiting for user`);
          return;
        }
      }

      // Dispatch phases synchronously — startUnifiedAgent is sync so sessions
      // exist in the DB before we release the lock, preventing duplicate dispatch.
      // We cap at concurrencyLimit; remaining phases will be picked up when these complete.
      const toDispatch = stepPhases.slice(0, concurrencyLimit);
      for (const phase of toDispatch) {
        try {
          // dispatchPhase returns a promise (resolves on agent completion) — we don't await it.
          // The synchronous startUnifiedAgent call inside creates the DB session immediately.
          dispatchPhase(phase, options, autonomyLevel);
        } catch (err) {
          console.error(`[processNextPhase] Error dispatching phase ${phase.id}:`, err);
        }
      }

      return;
    }

    // 6. No pending phases — check if review is needed
    handleNoPendingPhases(options, planId);
  } finally {
    dispatchingFeatures.delete(featureId);
  }
}

/**
 * When no pending phases remain, decide: run review or mark done.
 */
async function handleNoPendingPhases(options: ExecuteAgentOptions, _planId: number): Promise<void> {
  const { featureId, projectId } = options;

  // Check: did a review session complete more recently than the last execute/qa session?
  const lastReview = Effect.runSync(queryOne<{ id: number; ended_at: string | null }>(
    "SELECT id, ended_at FROM agent_sessions WHERE feature_id = ? AND agent_type = 'review' AND status = 'completed' ORDER BY id DESC LIMIT 1",
    featureId,
  ));

  const lastExecuteOrQa = Effect.runSync(queryOne<{ id: number; ended_at: string | null }>(
    "SELECT id, ended_at FROM agent_sessions WHERE feature_id = ? AND agent_type IN ('execute', 'qa') AND status = 'completed' ORDER BY id DESC LIMIT 1",
    featureId,
  ));

  let reviewRanAfterExecute: boolean;
  if (lastReview === null) {
    reviewRanAfterExecute = false;
  } else if (lastExecuteOrQa === null) {
    reviewRanAfterExecute = true; // review exists but no execute — review ran
  } else {
    reviewRanAfterExecute = lastReview.id > lastExecuteOrQa.id;
  }

  if (reviewRanAfterExecute) {
    // Review already ran and created no fix phases → done
    transitionFeature(getDatabase(), featureId, "done");
    notifyDbUpdated("feature", featureId);
    console.log(`[processNextPhase] Feature ${featureId} marked done — review clean`);
    return;
  }

  // Check if a review is already running
  const hasRunningReview = Effect.runSync(queryOne<{ id: number }>(
    "SELECT id FROM agent_sessions WHERE feature_id = ? AND agent_type = 'review' AND status = 'running' LIMIT 1",
    featureId,
  )) !== null;
  if (hasRunningReview) return;

  // Start review agent
  console.log(`[processNextPhase] Starting review for feature ${featureId}`);
  try {
    await startReviewAgent({
      featureId,
      projectId,
      cwd: options.cwd,
      worktreePath: options.worktreePath,
      onAgentDone: processNextPhaseCallback,
    });
  } catch (err) {
    console.error(`[processNextPhase] Failed to start review for feature ${featureId}:`, err);
  }
}

/**
 * Dispatch a phase to the appropriate executor based on phase_type.
 */
function dispatchPhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions,
  autonomyLevel: 1 | 2 | 3,
): Promise<void> {
  if (phase.phase_type === "qa") {
    return executeQaPhase(phase, options, autonomyLevel);
  }
  return executePhase(phase, options, autonomyLevel);
}

/**
 * Execute a single phase by starting a unified agent.
 * Returns a promise that resolves when the phase completes.
 */
function executePhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions,
  autonomyLevel: 1 | 2 | 3,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const db = getDatabase();

    transitionPhase(db, phase.id, "running", options.featureId);

    const prompt = buildEnrichedPrompt(phase, autonomyLevel);
    const phaseAction = buildPhaseCompletionAction(phase.id, options.featureId);

    const completionActions: CompletionAction[] = [
      {
        event: phaseAction.event,
        handler: async (output, context) => {
          await phaseAction.handler(output, context);
          resolve();
          // Chaining is handled by mcp-tools mark_agent_done → processNextPhase
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
      phaseId: phase.id,
      worktreePath: options.worktreePath,
      mcpServerFactory: buildMcpServerFactory("execute", options.featureId, undefined, processNextPhaseCallback),
    };

    startUnifiedAgent(config).catch(() => {
      transitionPhase(db, phase.id, "error", options.featureId);
      resolve();
    });
  });
}

/**
 * Execute a QA phase by starting the QA agent.
 * Returns a promise that resolves when the QA check completes.
 */
function executeQaPhase(
  phase: PhaseRow,
  options: ExecuteAgentOptions,
  autonomyLevel: 1 | 2 | 3,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const db = getDatabase();

    transitionPhase(db, phase.id, "running", options.featureId);

    const qaRow = db
      .prepare("SELECT qa_prompt FROM projects WHERE id = ?")
      .get(options.projectId) as { qa_prompt: string | null } | undefined;
    const qaPrompt = qaRow?.qa_prompt || "Run any available tests and verify the implementation works correctly.";

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
      onAgentDone: processNextPhaseCallback,
    });

    const originalActions = qaConfig.completionActions ?? [];
    qaConfig.completionActions = [
      ...originalActions,
      {
        event: "qa_phase_status",
        handler: (_output: string, context) => {
          const db2 = getDatabase();
          const session = db2.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(context.sessionDbId) as { status: string } | undefined;
          const phaseRow = db2.prepare("SELECT status FROM phases WHERE id = ?").get(phase.id) as { status: string } | undefined;
          const wasInterrupted = session?.status === "paused";

          if (wasInterrupted) {
            transitionPhaseIf(db2, phase.id, "running", "pending", options.featureId);
          } else if (phaseRow?.status === "running") {
            if (context.exitCode !== 0) {
              transitionPhaseIf(db2, phase.id, "running", "error", options.featureId);
            }
          }
          resolve();
          // Chaining is handled by mcp-tools mark_agent_done → processNextPhase
        },
      },
    ];

    qaConfig.phaseId = phase.id;

    startUnifiedAgent(qaConfig).catch(() => {
      transitionPhase(db, phase.id, "error", options.featureId);
      resolve();
    });
  });
}

/**
 * Build an enriched prompt for a phase, including plan-level context and previously completed phases.
 */
function buildEnrichedPrompt(phase: PhaseRow, autonomyLevel: 1 | 2 | 3 = 3): string {
  const db = getDatabase();

  const plan = db
    .prepare(
      "SELECT summary, context, clarifications, completion_conditions FROM plans WHERE id = ?",
    )
    .get(phase.plan_id) as Pick<
    PlanRow,
    "summary" | "context" | "clarifications" | "completion_conditions"
  > | undefined;

  const completedPhases = db
    .prepare(
      "SELECT step_number, title FROM phases WHERE plan_id = ? AND status = 'completed' AND step_number < ? ORDER BY step_number, order_index",
    )
    .all(phase.plan_id, phase.step_number) as Pick<
    PhaseRow,
    "step_number" | "title"
  >[];

  const sections: string[] = [];

  if (plan?.summary) {
    sections.push(`## Plan Summary\n\n${plan.summary}`);
  }
  if (plan?.context) {
    sections.push(`## Codebase Context\n\n${plan.context}`);
  }
  if (plan?.clarifications) {
    sections.push(`## Clarifications\n\n${plan.clarifications}`);
  }

  if (completedPhases.length > 0) {
    const phaseList = completedPhases
      .map((p) => `- Step ${p.step_number}: ${p.title}`)
      .join("\n");
    sections.push(
      `## Previously Completed Phases\n\nThe following phases have already been implemented. Use the \`read_phase\` tool if you need details about a specific phase.\n\n${phaseList}`,
    );
  }

  sections.push(
    `## Current Phase: ${phase.title}\n\nPhase ID: ${phase.id}\n\n${phase.prompt}\n\nFocus only on this phase's scope. Call \`mark_phase_done\` with phase_id=${phase.id} when complete.`,
  );

  const commitMsg = phase.commit_message ?? "implement phase changes";
  const commitInstructions = `To commit, stage ONLY the files you modified (do NOT use \`git add -A\` or \`git add .\` as other agents may be running in parallel). Use \`git add <file1> <file2> ...\` for each file you changed, then:\n\`\`\`\ngit commit -m ${JSON.stringify(commitMsg)}\n\`\`\``;

  if (autonomyLevel === 1) {
    sections.push(
      `## User Approval Required\n\nAfter outputting your implementation notes and deviations, you MUST ask the user for approval using AskUserQuestion:\n\n- Question: "Review complete. Approve changes and commit?"\n- Options: "Approve and commit", "Skip commit", "Request changes"\n\nIf the user selects "Request changes", they will provide feedback via the "Other" option. In that case:\n1. Read and address their feedback\n2. Make the necessary fixes\n3. Re-output your updated implementation notes and deviations\n4. Ask for approval again\n\nIf the user selects "Approve and commit":\n${commitInstructions}\n\nThen call \`mark_phase_done\` with your implementation notes and deviations.\n\n**Do NOT call \`mark_phase_done\` until after approval and successful commit.**\n\nIf the user selects "Skip commit", do NOT commit.\n\nRepeat the approval loop until the user approves or skips. Only call \`mark_agent_done\` after the user has approved or skipped.`,
    );
  } else {
    sections.push(
      `## Auto-Commit\n\nAfter completing your implementation, automatically commit your changes:\n${commitInstructions}\n\nAfter committing, call \`mark_phase_done\` with your implementation notes and deviations. **Do NOT call \`mark_phase_done\` before committing.**\n\nThen call \`mark_agent_done\`.`,
    );
  }

  return sections.join("\n\n---\n\n");
}

// getAutonomyLevel moved to ./autonomy.ts to break circular dependency
export { getAutonomyLevel } from "./autonomy";

/**
 * Check if parallel execution is enabled: feature → project → global settings cascade.
 * Returns the concurrency limit (MAX_AGENTS_PER_FEATURE when enabled, 1 when disabled).
 */
function getConcurrencyLimit(featureId: number, projectId: number): number {
  const raw = resolveSetting("parallel_execution", { featureId, projectId, defaultValue: "true" });
  return raw === "false" ? 1 : MAX_AGENTS_PER_FEATURE;
}

/**
 * Build a completion action that syncs phase status when an execute agent finishes.
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
        transitionPhaseIf(db2, phaseId, "running", "pending", featureId);
      } else if (context.exitCode !== 0) {
        transitionPhaseIf(db2, phaseId, "running", "error", featureId);
      }
    },
  };
}
