/**
 * Brainstorm Agent — thin wrapper that builds a UnifiedAgentConfig and delegates
 * to startUnifiedAgent.
 *
 * Pre-creation of the draft plan record and feature_settings entry stays here
 * because those are plan-specific DB concerns that the unified agent doesn't
 * know about.
 */

import { getDatabase } from "../db/database";
import { startUnifiedAgent, type UnifiedAgentResult } from "./unified-agent";
import { createBrainstormConfig } from "./agent-configs";
import type { AgentType } from "./types";

export interface BrainstormAgentOptions {
  featureId: number;
  projectId: number;
  description: string;
  /** Working directory (worktree path or project path) */
  cwd: string;
  /** Worktree path for permission resolution */
  worktreePath?: string;
}

export interface BrainstormAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the brainstorm agent for a feature.
 */
export function startBrainstormAgent(options: BrainstormAgentOptions): BrainstormAgentResult {
  const db = getDatabase();

  // Create plan record (draft) — must exist before the completion action runs
  const planResult = db
    .prepare(
      "INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')",
    )
    .run(options.featureId, `Brainstorm plan for feature #${options.featureId}`);
  const planId = Number(planResult.lastInsertRowid);

  // Store plan ID in feature settings
  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(options.featureId, "current_plan_id", String(planId));

  // Build unified config and start
  const config = createBrainstormConfig({
    featureId: options.featureId,
    projectId: options.projectId,
    cwd: options.cwd,
    description: options.description,
    planId,
    worktreePath: options.worktreePath,
  });

  const result: UnifiedAgentResult = startUnifiedAgent(config);

  return {
    subprocessId: result.subprocessId,
    agentType: result.agentType,
    sessionDbId: result.sessionDbId,
  };
}
