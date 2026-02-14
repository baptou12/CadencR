/**
 * Plan Agent — thin wrapper that builds a UnifiedAgentConfig and delegates
 * to startUnifiedAgent.
 *
 * Pre-creation of the draft plan record and feature_settings entry stays here
 * because those are plan-specific DB concerns that the unified agent doesn't
 * know about.
 */

import { getDatabase } from "../db/database";
import { startUnifiedAgent, type UnifiedAgentResult } from "./unified-agent";
import { createPlanConfig } from "./agent-configs";
import type { AgentType } from "./types";

// Re-export parsePlanOutput from utils for backwards compatibility
// (brainstorm-agent previously imported it from here)
export { parsePlanOutput, type ParsedPlan, type ParsedPhase } from "./utils";

export interface PlanAgentOptions {
  featureId: number;
  projectId: number;
  description: string;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface PlanAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the plan agent for a feature.
 */
export function startPlanAgent(options: PlanAgentOptions): PlanAgentResult {
  const db = getDatabase();

  // Create plan record (draft) — must exist before the completion action runs
  const planResult = db
    .prepare(
      "INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')",
    )
    .run(options.featureId, `Plan for feature #${options.featureId}`);
  const planId = Number(planResult.lastInsertRowid);

  // Store plan ID in feature settings for later reference
  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(options.featureId, "current_plan_id", String(planId));

  // Build unified config and start
  const config = createPlanConfig({
    featureId: options.featureId,
    projectId: options.projectId,
    cwd: options.cwd,
    description: options.description,
    planId,
  });

  const result: UnifiedAgentResult = startUnifiedAgent(config);

  return {
    subprocessId: result.subprocessId,
    agentType: result.agentType,
    sessionDbId: result.sessionDbId,
  };
}
