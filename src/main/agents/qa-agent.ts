/**
 * QA Agent — thin wrapper that builds a UnifiedAgentConfig and delegates
 * to startUnifiedAgent.
 */

import { getDatabase } from "../db/database";
import { startUnifiedAgent, type UnifiedAgentResult } from "./unified-agent";
import { createQaConfig } from "./agent-configs";
import type { AgentType, UnifiedAgentConfig } from "./types";

export interface QaAgentOptions {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}

export interface QaAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start the QA agent for a feature.
 */
export function startQaAgent(options: QaAgentOptions): QaAgentResult {
  const db = getDatabase();

  // Get QA prompt from project settings
  const qaRow = db
    .prepare("SELECT value FROM project_settings WHERE project_id = ? AND key = 'qa_prompt'")
    .get(options.projectId) as { value: string } | undefined;

  const qaPrompt = qaRow?.value || "Run any available tests and verify the implementation works correctly.";

  // Get active plan
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number } | undefined;

  if (!plan) {
    throw new Error("No active plan found for QA.");
  }

  // Build summary of completed phases
  const completedPhases = db
    .prepare(
      "SELECT step_number, title, implementation_notes FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
    )
    .all(plan.id) as { step_number: number; title: string; implementation_notes: string | null }[];

  const completedPhasesSummary = completedPhases.length > 0
    ? "The following phases have been completed:\n\n" +
      completedPhases
        .map((p) => {
          let entry = `- **Phase (step ${p.step_number}): ${p.title}**`;
          if (p.implementation_notes) {
            entry += `\n  - ${p.implementation_notes}`;
          }
          return entry;
        })
        .join("\n")
    : "No phases have been completed yet.";

  // Get max step number from completed phases to position fix phases correctly
  const maxStepRow = db
    .prepare("SELECT MAX(step_number) as max_step FROM phases WHERE plan_id = ? AND status = 'completed'")
    .get(plan.id) as { max_step: number | null };
  const qaPhaseStepNumber = maxStepRow?.max_step ?? 0;

  const config: UnifiedAgentConfig = createQaConfig({
    featureId: options.featureId,
    projectId: options.projectId,
    cwd: options.cwd,
    qaPrompt,
    completedPhasesSummary,
    planId: plan.id,
    qaPhaseStepNumber,
    worktreePath: options.worktreePath,
  });

  const result: UnifiedAgentResult = startUnifiedAgent(config);

  return {
    subprocessId: result.subprocessId,
    agentType: result.agentType,
    sessionDbId: result.sessionDbId,
  };
}
