/**
 * Review Agent — thin wrapper that builds a UnifiedAgentConfig and delegates
 * to startUnifiedAgent.
 *
 * Setting the feature status to "review" before starting stays here because
 * it's a review-agent-specific side effect. The `addFixPhase` helper also
 * lives here as it's review-specific business logic.
 */

import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./ipc-bridge";
import { startUnifiedAgent, type UnifiedAgentResult } from "./unified-agent";
import { createReviewConfig } from "./agent-configs";
import type { AgentType } from "./types";
import type { PlanRow, PhaseRow } from "../db/types";

export interface ReviewAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface ReviewAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the review agent for a feature.
 */
export function startReviewAgent(options: ReviewAgentOptions): ReviewAgentResult {
  const db = getDatabase();

  // Update feature status to review
  db.prepare("UPDATE features SET status = 'review' WHERE id = ?").run(options.featureId);
  notifyDbUpdated("feature", options.featureId);

  // Build unified config and start
  const config = createReviewConfig({
    featureId: options.featureId,
    projectId: options.projectId,
    cwd: options.cwd,
  });

  const result: UnifiedAgentResult = startUnifiedAgent(config);

  return {
    subprocessId: result.subprocessId,
    agentType: result.agentType,
    sessionDbId: result.sessionDbId,
  };
}

/**
 * Add a fix phase to the existing plan for later execution.
 */
export function addFixPhase(featureId: number, fixDescription: string): { phaseId: number } {
  const db = getDatabase();

  // Get the plan
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(featureId) as Pick<PlanRow, "id"> | undefined;

  if (!plan) {
    throw new Error("No plan found for this feature");
  }

  // Get the highest step_number and order_index
  const lastPhase = db
    .prepare("SELECT step_number, order_index FROM phases WHERE plan_id = ? ORDER BY step_number DESC, order_index DESC LIMIT 1")
    .get(plan.id) as Pick<PhaseRow, "step_number" | "order_index"> | undefined;

  const stepNumber = (lastPhase?.step_number ?? 0) + 1;
  const orderIndex = 0;

  const result = db
    .prepare(
      "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      plan.id,
      stepNumber,
      "Review fixes",
      "pending",
      2,
      "fix: address review findings",
      fixDescription,
      orderIndex,
    );

  return { phaseId: Number(result.lastInsertRowid) };
}
