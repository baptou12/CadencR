/**
 * Shared helper functions for MCP tool servers.
 */

import type { Effect } from "effect";
import { queryOneValidated, queryAllValidated } from "../../db/query";
import { AppRuntime } from "../../effect/runtime";
import { PlanRowSchema, PhaseRowSchema } from "../../effect/schemas/db-schemas";

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/**
 * Safely run an Effect via AppRuntime. Returns null on failure and logs a warning.
 * Use this when the calling code can handle null gracefully.
 */
export async function runPromiseSafe<T>(effect: Effect.Effect<T, unknown>): Promise<T | null> {
  try {
    return await AppRuntime.runPromise(effect);
  } catch (e) {
    console.warn("[mcp-tools] runPromiseSafe error:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Render a plan and its phases as formatted markdown.
 */
export async function renderPlanMarkdown(planId: number): Promise<string> {
  try {
    return await renderPlanMarkdownUnsafe(planId);
  } catch (e) {
    return `Error loading plan: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function renderPlanMarkdownUnsafe(planId: number): Promise<string> {
  const plan = await AppRuntime.runPromise(queryOneValidated(PlanRowSchema, "SELECT * FROM plans WHERE id = ?", planId));
  if (plan === null) return "Plan not found.";

  const phases = await AppRuntime.runPromise(queryAllValidated(PhaseRowSchema,
    "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
    planId,
  ));

  const sections: string[] = [];
  sections.push(`# Plan: ${plan.title}`);

  if (plan.summary) sections.push(`## Summary\n\n${plan.summary}`);
  if (plan.context) sections.push(`## Context\n\n${plan.context}`);
  if (plan.clarifications) sections.push(`## Clarifications\n\n${plan.clarifications}`);
  if (plan.completion_conditions) sections.push(`## Completion Conditions\n\n${plan.completion_conditions}`);

  if (phases.length > 0) {
    sections.push("## Phases\n");
    for (const phase of phases) {
      const lines = [`### Phase ${phase.step_number}: ${phase.title}`];
      lines.push(`- **Step**: ${phase.step_number}`);
      lines.push(`- **Type**: ${phase.phase_type}`);
      lines.push(`- **Complexity**: ${phase.complexity}`);
      lines.push(`- **Status**: ${phase.status}`);
      if (phase.commit_message) lines.push(`- **Commit message**: ${phase.commit_message}`);
      if (phase.prompt) lines.push(`\n${phase.prompt}`);
      sections.push(lines.join("\n"));
    }
  }

  return sections.join("\n\n");
}
