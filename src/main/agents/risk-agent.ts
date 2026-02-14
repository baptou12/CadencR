/**
 * Risk Analysis Agent — thin wrapper that builds a UnifiedAgentConfig and
 * delegates to startUnifiedAgent.
 *
 * Fetching the plan context for the prompt stays here because it's a
 * risk-agent-specific DB query.
 */

import { getDatabase } from "../db/database";
import { startUnifiedAgent, type UnifiedAgentResult } from "./unified-agent";
import { createRiskConfig } from "./agent-configs";
import type { AgentType } from "./types";

export interface RiskAgentOptions {
  featureId: number;
  projectId: number;
  /** Working directory (worktree path or project path) */
  cwd: string;
}

export interface RiskAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the risk analysis agent for a feature.
 */
export function startRiskAgent(options: RiskAgentOptions): RiskAgentResult {
  const db = getDatabase();

  // Fetch the plan for context
  const plan = db
    .prepare("SELECT id, raw_markdown, title FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number; raw_markdown: string | null; title: string } | undefined;

  const planContext = plan?.raw_markdown
    ? `\n\nHere is the implementation plan to evaluate:\n\n${plan.raw_markdown}`
    : "";

  const prompt = `Please perform a risk analysis for this feature.${planContext}

Start by exploring the codebase to understand the full context and impact of these changes. Then generate a comprehensive risk report in markdown format.`;

  // Build unified config and start
  const config = createRiskConfig({
    featureId: options.featureId,
    projectId: options.projectId,
    cwd: options.cwd,
    prompt,
  });

  const result: UnifiedAgentResult = startUnifiedAgent(config);

  return {
    subprocessId: result.subprocessId,
    agentType: result.agentType,
    sessionDbId: result.sessionDbId,
  };
}
