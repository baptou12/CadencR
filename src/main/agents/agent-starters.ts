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
  createPrdConfig,
  createRiskConfig,
  createReviewConfig,
  createQaConfig,
  createReviewFixerConfig,
} from "./agent-configs";
import type { AgentType, MessageContent, UnifiedAgentConfig } from "./types";
import type { PlanRow, PhaseRow } from "../db/types";
import { getAutonomyLevel } from "./execute-agent";


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
  prompt: MessageContent;
  cwd: string;
  resumeSessionId?: string;
  permissionMode?: "acceptEdits" | "plan";
  worktreePath?: string;
  planId?: number;
}): AgentResult {
  return startUnifiedAgent(createSessionConfig(options));
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function startPlanAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
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
  description: MessageContent;
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
// PRD
// ---------------------------------------------------------------------------

export function startPrdAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  // PRD is stored on the features table, no plan row needed
  return startUnifiedAgent(createPrdConfig(options));
}

// ---------------------------------------------------------------------------
// Refine Plan / Brainstorm (append new phases to existing plan)
// ---------------------------------------------------------------------------

function buildRefineContext(db: ReturnType<typeof getDatabase>, featureId: number): { planId: number; context: string } {
  const plan = db
    .prepare("SELECT id, title, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(featureId) as { id: number; title: string | null; summary: string | null; context: string | null } | undefined;

  if (!plan) throw new Error("No plan found for this feature — cannot refine without an existing plan.");

  const phases = db
    .prepare(
      "SELECT step_number, title, status, implementation_notes, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
    )
    .all(plan.id) as { step_number: number; title: string; status: string; implementation_notes: string | null; phase_type: string | null }[];

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

export function startRefinePlanAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();
  const { planId, context } = buildRefineContext(db, options.featureId);

  // Augment description with existing plan context
  const augmented: MessageContent = typeof options.description === "string"
    ? `${context}\n\n## User's Refinement Request\n${options.description}`
    : [{ type: "text" as const, text: `${context}\n\n## User's Refinement Request\n` }, ...(options.description as Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }>)];

  return startUnifiedAgent(
    createPlanConfig({ ...options, description: augmented, planId }),
  );
}

export function startRefineBrainstormAgent(options: {
  featureId: number;
  projectId: number;
  description: MessageContent;
  cwd: string;
  worktreePath?: string;
}): AgentResult {
  const db = getDatabase();
  const { planId, context } = buildRefineContext(db, options.featureId);

  const augmented: MessageContent = typeof options.description === "string"
    ? `${context}\n\n## User's Refinement Request\n${options.description}`
    : [{ type: "text" as const, text: `${context}\n\n## User's Refinement Request\n` }, ...(options.description as Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }>)];

  return startUnifiedAgent(
    createBrainstormConfig({ ...options, description: augmented, planId }),
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

  // 1. Query the feature
  const feature = db
    .prepare("SELECT title FROM features WHERE id = ?")
    .get(options.featureId) as { title: string } | undefined;

  // 2. Query the plan (rich fields)
  const plan = db
    .prepare("SELECT id, summary, context, raw_markdown FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1")
    .get(options.featureId) as { id: number; summary: string | null; context: string | null; raw_markdown: string | null } | undefined;

  // 3. Query phases
  const phases = plan
    ? (db
        .prepare("SELECT title, status, step_number FROM phases WHERE plan_id = ? ORDER BY step_number, order_index")
        .all(plan.id) as { title: string; status: string; step_number: number }[])
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
// Review Fixer
// ---------------------------------------------------------------------------

export function startReviewFixerAgent(options: {
  featureId: number;
  projectId: number;
  cwd: string;
  prompt: MessageContent;
  worktreePath?: string;
}): AgentResult {
  const autonomyLevel = getAutonomyLevel(options.featureId, options.projectId);
  return startUnifiedAgent(createReviewFixerConfig({ ...options, autonomyLevel }));
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
    .prepare("SELECT MAX(step_number) as max_step FROM phases WHERE plan_id = ?")
    .get(plan.id) as { max_step: number | null };
  const qaPhaseStepNumber = (maxStepRow?.max_step ?? 0) + 1;

  // Create a QA phase so the agent can mark it running → completed
  const insertResult = db
    .prepare(
      "INSERT INTO phases (plan_id, step_number, title, status, phase_type, order_index) VALUES (?, ?, ?, 'running', 'qa', 0)",
    )
    .run(plan.id, qaPhaseStepNumber, "Manual QA");
  const phaseId = Number(insertResult.lastInsertRowid);

  const autonomyLevel = getAutonomyLevel(options.featureId, options.projectId);

  const config: UnifiedAgentConfig = createQaConfig({
    ...options,
    qaPrompt,
    completedPhasesSummary,
    planId: plan.id,
    phaseId,
    qaPhaseStepNumber,
    autonomyLevel,
  });

  // After QA finishes, auto-start execution if fix phases were created
  const existingActions = config.completionActions ?? [];
  config.completionActions = [
    ...existingActions,
    {
      event: "qa_auto_execute",
      handler: (_output: string) => {
        const db2 = getDatabase();
        const pending = db2
          .prepare(
            "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'pending'",
          )
          .get(plan.id) as { cnt: number };

        if (pending.cnt > 0) {
          // Dynamically import to avoid circular dependency
          const { startExecuteAgent } = require("./execute-agent");
          try {
            startExecuteAgent(options);
          } catch (err) {
            console.error("[qa-auto-execute] Failed to auto-start execution after QA:", err);
          }
        }
      },
    },
  ];

  return startUnifiedAgent(config);
}
