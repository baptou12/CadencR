/**
 * Agent starter functions — consolidates the thin wrappers that were
 * previously spread across separate agent files.
 *
 * Each function does agent-specific DB pre-work, builds a config, and delegates
 * to startUnifiedAgent. The addFixPhase helper (review-specific) also lives here.
 */

import { Effect } from "effect";
import { getDatabase } from "../db/database";
import { queryOne, queryAll, execute } from "../db/query";
import { transitionFeature } from "./state-transitions";
import { startUnifiedAgent } from "./unified-agent";
import {
  createSessionConfig,
  createPlanConfig,
  createPrdConfig,
  createRiskConfig,
  createReviewConfig,
  createQaConfig,
  createReviewFixerConfig,
  createRetroConfig,
} from "./agent-configs";
import type { AgentType, MessageContent, UnifiedAgentConfig } from "./types";
import type { PlanRow, PhaseRow } from "../db/types";
import { getAutonomyLevel } from "./autonomy";


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

export async function startSessionAgent(options: {
  featureId?: number;
  projectId: number;
  prompt: MessageContent;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: "acceptEdits" | "plan";
  worktreePath?: string;
  planId?: number;
}): Promise<AgentResult> {
  return startUnifiedAgent(createSessionConfig(options));
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function startPlanAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
  cwd: string;
  worktreePath?: string;
}): Promise<AgentResult> {
  // If a PRD exists on the feature, use it as the description
  const feature = Effect.runSync(queryOne<{ prd: string | null }>(
    "SELECT prd FROM features WHERE id = ?",
    options.featureId,
  ));
  const hasPrd = !!feature?.prd;
  if (feature?.prd) {
    options.description = feature.prd;
  }

  // Create plan record (draft) — must exist before the completion action runs
  const planResult = Effect.runSync(execute(
    "INSERT INTO plans (feature_id, title, status) VALUES (?, ?, 'draft')",
    options.featureId, `Plan for feature #${options.featureId}`,
  ));
  const planId = planResult.lastInsertRowid;

  // Store plan ID in feature settings for later reference
  Effect.runSync(execute(
    "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
    options.featureId, "current_plan_id", String(planId),
  ));

  return startUnifiedAgent(
    createPlanConfig({ ...options, planId, hasPrd }),
  );
}

// ---------------------------------------------------------------------------
// PRD
// ---------------------------------------------------------------------------

export async function startPrdAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
  cwd: string;
  worktreePath?: string;
}): Promise<AgentResult> {
  // PRD is stored on the features table, no plan row needed
  return startUnifiedAgent(createPrdConfig(options));
}

// ---------------------------------------------------------------------------
// Refine Plan (append new phases to existing plan)
// ---------------------------------------------------------------------------

function buildRefineContext(featureId: number): { planId: number; context: string } {
  const plan = Effect.runSync(queryOne<{ id: number; title: string | null; summary: string | null; context: string | null }>(
    "SELECT id, title, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    featureId,
  ));

  if (!plan) throw new Error("No plan found for this feature — cannot refine without an existing plan.");

  const phases = Effect.runSync(queryAll<{ step_number: number; title: string; status: string; implementation_notes: string | null; phase_type: string | null }>(
    "SELECT step_number, title, status, implementation_notes, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
    plan.id,
  ));

  const maxStep = phases.length > 0 ? Math.max(...phases.map((p) => p.step_number)) : 0;

  const parts: string[] = [];
  if (plan.summary) parts.push(`**Plan Summary:** ${plan.summary}`);
  if (plan.context) parts.push(`**Codebase Context:** ${plan.context}`);

  if (phases.length > 0) {
    parts.push("\n## Existing Phases:");
    for (const p of phases) {
      let line = `Step ${p.step_number}. [${p.status.toUpperCase()}] ${p.title}`;
      if (p.phase_type) line += ` (${p.phase_type})`;
      if (p.implementation_notes) line += `\n   Notes: ${p.implementation_notes}`;
      parts.push(line);
    }
  }

  const refineInstructions = `
## Refinement Instructions
This is a REFINEMENT of an existing plan (Plan ID: ${plan.id}). The phases listed above already exist.
- Do NOT recreate or duplicate completed phases.
- Add NEW phases to extend the plan based on the user's request below.
- Use step numbers starting from ${maxStep + 1}.
- You may also update or remove existing DRAFT or PENDING phases if needed.
- After building the new phases, call show_plan for approval, then finalize_plan.`;

  return { planId: plan.id, context: parts.join("\n") + refineInstructions };
}

export async function startRefinePlanAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
  cwd: string;
  worktreePath?: string;
}): Promise<AgentResult> {
  const { planId, context } = buildRefineContext(options.featureId);

  // Augment description with existing plan context
  const augmented: MessageContent = typeof options.description === "string"
    ? `${context}\n\n## User's Refinement Request\n${options.description}`
    : [{ type: "text" as const, text: `${context}\n\n## User's Refinement Request\n` }, ...(options.description as Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }>)];

  return startUnifiedAgent(
    createPlanConfig({ ...options, description: augmented, planId }),
  );
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export async function startRiskAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}): Promise<AgentResult> {
  // 1. Query the feature
  const feature = Effect.runSync(queryOne<{ title: string }>(
    "SELECT title FROM features WHERE id = ?",
    options.featureId,
  ));

  // 2. Query the plan (rich fields)
  const plan = Effect.runSync(queryOne<{ id: number; summary: string | null; context: string | null; raw_markdown: string | null }>(
    "SELECT id, summary, context, raw_markdown FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    options.featureId,
  ));

  // 3. Query phases
  const phases = plan
    ? Effect.runSync(queryAll<{ title: string; status: string; step_number: number }>(
        "SELECT title, status, step_number FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        plan.id,
      ))
    : [];

  // 4. Build rich context string
  const contextParts: string[] = [];
  contextParts.push(`## Feature: ${feature?.title ?? `#${options.featureId}`}`);
  if (plan?.summary) contextParts.push(`**Plan Summary:** ${plan.summary}`);
  if (plan?.context) contextParts.push(`**Codebase Context:** ${plan.context}`);

  if (phases.length > 0) {
    contextParts.push("\n## Phases:");
    for (const p of phases) {
      contextParts.push(`${p.step_number}. ${p.title} — ${p.status}`);
    }
  }

  if (plan?.raw_markdown) {
    contextParts.push(`\n## Full Plan\n${plan.raw_markdown}`);
  }

  const richContext = contextParts.join("\n");

  const planIdNote = plan ? `\n\n**Plan ID: ${plan.id}** — Use this ID when calling MCP tools like \`read_plan\`, \`list_phases\`, \`create_phase\`, \`finalize_phases\`, etc.` : "";

  const prompt = `Please perform a risk analysis for this feature.

${richContext}${planIdNote}

Start by running \`git diff main...HEAD\` (or the appropriate base branch) to see what code has actually changed. Then explore the codebase to understand the full context and impact of these changes. Generate a comprehensive risk report.`;

  return startUnifiedAgent(
    createRiskConfig({ ...options, prompt, planId: plan?.id }),
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function startReviewAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
  onAgentDone?: import("./mcp-tools").OnAgentDoneCallback;
}): Promise<AgentResult> {
  // Keep feature in-progress during review
  transitionFeature(getDatabase(), options.featureId, "in-progress");

  // Look up plan with context for the review prompt
  const plan = Effect.runSync(queryOne<{ id: number; summary: string | null; context: string | null; clarifications: string | null }>(
    "SELECT id, summary, context, clarifications FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    options.featureId,
  ));

  if (!plan) throw new Error("No plan found for this feature");

  // Fetch PRD if available
  const feature = Effect.runSync(queryOne<{ prd: string | null }>(
    "SELECT prd FROM features WHERE id = ?",
    options.featureId,
  ));

  // Fetch completed phase titles
  const completedPhases = Effect.runSync(queryAll<{ step_number: number; title: string }>(
    "SELECT step_number, title FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
    plan.id,
  ));

  const autonomyLevel = getAutonomyLevel(options.featureId, options.projectId);

  return startUnifiedAgent(
    createReviewConfig({
      ...options,
      planId: plan.id,
      prd: feature?.prd ?? undefined,
      planSummary: plan.summary ?? undefined,
      planContext: plan.context ?? undefined,
      planClarifications: plan.clarifications ?? undefined,
      completedPhases,
      autonomyLevel,
      onAgentDone: options.onAgentDone,
    }),
  );
}

/**
 * Add a fix phase to the existing plan for later execution.
 */
export function addFixPhase(featureId: number, fixDescription: string): { phaseId: number } {
  const plan = Effect.runSync(queryOne<Pick<PlanRow, "id">>(
    "SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1",
    featureId,
  ));

  if (!plan) throw new Error("No plan found for this feature");

  const lastPhase = Effect.runSync(queryOne<Pick<PhaseRow, "step_number" | "order_index">>(
    "SELECT step_number, order_index FROM phases WHERE plan_id = ? ORDER BY step_number DESC, order_index DESC LIMIT 1",
    plan.id,
  ));

  const stepNumber = (lastPhase?.step_number ?? 0) + 1;

  const result = Effect.runSync(execute(
    "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    plan.id, stepNumber, "Review fixes", "pending", 2, "fix: address review findings", fixDescription, 0,
  ));

  return { phaseId: result.lastInsertRowid };
}

// ---------------------------------------------------------------------------
// Review Fixer
// ---------------------------------------------------------------------------

export async function startReviewFixerAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  prompt: MessageContent;
  worktreePath?: string;
}): Promise<AgentResult> {
  const autonomyLevel = getAutonomyLevel(options.featureId, options.projectId);
  return startUnifiedAgent(createReviewFixerConfig({ ...options, autonomyLevel }));
}

// ---------------------------------------------------------------------------
// Retro
// ---------------------------------------------------------------------------

export async function startRetroAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}): Promise<AgentResult> {
  return startUnifiedAgent(createRetroConfig(options));
}

// ---------------------------------------------------------------------------
// QA
// ---------------------------------------------------------------------------

export async function startQaAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  worktreePath?: string;
}): Promise<AgentResult> {
  const qaRow = Effect.runSync(queryOne<{ qa_prompt: string | null }>(
    "SELECT qa_prompt FROM projects WHERE id = ?",
    options.projectId,
  ));

  const qaPrompt = qaRow?.qa_prompt || "Run any available tests and verify the implementation works correctly.";

  const plan = Effect.runSync(queryOne<{ id: number }>(
    "SELECT id FROM plans WHERE feature_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
    options.featureId,
  ));

  if (!plan) throw new Error("No active plan found for QA.");

  const completedPhases = Effect.runSync(queryAll<{ step_number: number; title: string; implementation_notes: string | null }>(
    "SELECT step_number, title, implementation_notes FROM phases WHERE plan_id = ? AND status = 'completed' ORDER BY step_number, order_index",
    plan.id,
  ));

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

  const maxStepRow = Effect.runSync(queryOne<{ max_step: number | null }>(
    "SELECT MAX(step_number) as max_step FROM phases WHERE plan_id = ?",
    plan.id,
  ));
  const qaPhaseStepNumber = (maxStepRow?.max_step ?? 0) + 1;

  // Create a QA phase so the agent can mark it running → completed
  const insertResult = Effect.runSync(execute(
    "INSERT INTO phases (plan_id, step_number, title, status, phase_type, order_index) VALUES (?, ?, ?, 'running', 'qa', 0)",
    plan.id, qaPhaseStepNumber, "Manual QA",
  ));
  const phaseId = insertResult.lastInsertRowid;

  const autonomyLevel = getAutonomyLevel(options.featureId, options.projectId);

  // Check if this is the final QA phase (all non-QA phases are completed)
  const pendingNonQa = Effect.runSync(queryOne<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND phase_type IS NOT 'qa' AND status != 'completed'",
    plan.id,
  ));

  let prd: string | undefined;
  if (pendingNonQa !== null && pendingNonQa.cnt === 0) {
    const feature = Effect.runSync(queryOne<{ prd: string | null }>(
      "SELECT prd FROM features WHERE id = ?",
      options.featureId,
    ));
    if (feature?.prd) {
      prd = feature.prd;
    }
  }

  const config: UnifiedAgentConfig = createQaConfig({
    ...options,
    qaPrompt,
    completedPhasesSummary,
    planId: plan.id,
    phaseId,
    qaPhaseStepNumber,
    autonomyLevel,
    prd,
  });

  return startUnifiedAgent(config);
}
