/**
 * Agent starter functions — consolidates the thin wrappers that were
 * previously spread across 6 separate files (plan-agent.ts, brainstorm-agent.ts,
 * session-agent.ts, review-agent.ts, risk-agent.ts, qa-agent.ts).
 *
 * Each function does agent-specific DB pre-work, builds a config, and delegates
 * to startUnifiedAgent. The addFixPhase helper (review-specific) also lives here.
 */

import { getDatabase } from "../db/database";
import { transitionFeature } from "./state-transitions";
import { startUnifiedAgent } from "./unified-agent";
import {
  createSessionConfig,
  createPlanConfig,
  createBrainstormConfig,
  createRiskConfig,
  createReviewConfig,
  createQaConfig,
} from "./agent-configs";
import type { AgentType, UnifiedAgentConfig } from "./types";
import type { PlanRow, PhaseRow } from "../db/types";


// ---------------------------------------------------------------------------
// Common types
// ---------------------------------------------------------------------------

export interface AgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export function startSessionAgent(options: {
  featureId?: number;
  projectId: number;
  prompt: string;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: "acceptEdits" | "plan";
  worktreePath?: string;
}): AgentResult {
  return startUnifiedAgent(createSessionConfig(options));
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function startPlanAgent(options: {
  featureId: number;
  projectId: number;
  description: string;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();

  // Create plan record (draft) — must exist before the completion action runs
  const planResult = db
    .prepare("INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')")
    .run(options.featureId, `Plan for feature #${options.featureId}`);
  const planId = Number(planResult.lastInsertRowid);

  // Store plan ID in feature settings for later reference
  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(options.featureId, "current_plan_id", String(planId));

  return startUnifiedAgent(
    createPlanConfig({ ...options, planId }),
  );
}

// ---------------------------------------------------------------------------
// Brainstorm
// ---------------------------------------------------------------------------

export function startBrainstormAgent(options: {
  featureId: number;
  projectId: number;
  description: string;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();

  const planResult = db
    .prepare("INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')")
    .run(options.featureId, `Brainstorm plan for feature #${options.featureId}`);
  const planId = Number(planResult.lastInsertRowid);

  db.prepare(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
  ).run(options.featureId, "current_plan_id", String(planId));

  return startUnifiedAgent(
    createBrainstormConfig({ ...options, planId }),
  );
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export function startRiskAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();

  const plan = db
    .prepare("SELECT id, raw_markdown, title FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number; raw_markdown: string | null; title: string } | undefined;

  const planContext = plan?.raw_markdown
    ? `\n\nHere is the implementation plan to evaluate:\n\n${plan.raw_markdown}`
    : "";

  const prompt = `Please perform a risk analysis for this feature.${planContext}

Start by exploring the codebase to understand the full context and impact of these changes. Then generate a comprehensive risk report in markdown format.`;

  return startUnifiedAgent(
    createRiskConfig({ ...options, prompt }),
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export function startReviewAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();

  // Update feature status to review
  transitionFeature(db, options.featureId, "review");

  // Look up plan ID for the review MCP server
  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number } | undefined;

  if (!plan) throw new Error("No plan found for this feature");

  return startUnifiedAgent(
    createReviewConfig({ ...options, planId: plan.id }),
  );
}

/**
 * Add a fix phase to the existing plan for later execution.
 */
export function addFixPhase(featureId: number, fixDescription: string): { phaseId: number } {
  const db = getDatabase();

  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(featureId) as Pick<PlanRow, "id"> | undefined;

  if (!plan) throw new Error("No plan found for this feature");

  const lastPhase = db
    .prepare("SELECT step_number, order_index FROM phases WHERE plan_id = ? ORDER BY step_number DESC, order_index DESC LIMIT 1")
    .get(plan.id) as Pick<PhaseRow, "step_number" | "order_index"> | undefined;

  const stepNumber = (lastPhase?.step_number ?? 0) + 1;

  const result = db
    .prepare(
      "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(plan.id, stepNumber, "Review fixes", "pending", 2, "fix: address review findings", fixDescription, 0);

  return { phaseId: Number(result.lastInsertRowid) };
}

// ---------------------------------------------------------------------------
// QA
// ---------------------------------------------------------------------------

export function startQaAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();

  const qaRow = db
    .prepare("SELECT qa_prompt FROM projects WHERE id = ?")
    .get(options.projectId) as { qa_prompt: string | null } | undefined;

  const qaPrompt = qaRow?.qa_prompt || "Run any available tests and verify the implementation works correctly.";

  const plan = db
    .prepare("SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number } | undefined;

  if (!plan) throw new Error("No active plan found for QA.");

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
          if (p.implementation_notes) entry += `\n  - ${p.implementation_notes}`;
          return entry;
        })
        .join("\n")
    : "No phases have been completed yet.";

  const maxStepRow = db
    .prepare("SELECT MAX(step_number) as max_step FROM phases WHERE plan_id = ? AND status = 'completed'")
    .get(plan.id) as { max_step: number | null };
  const qaPhaseStepNumber = maxStepRow?.max_step ?? 0;

  const config: UnifiedAgentConfig = createQaConfig({
    ...options,
    qaPrompt,
    completedPhasesSummary,
    planId: plan.id,
    qaPhaseStepNumber,
  });

  return startUnifiedAgent(config);
}
