/**
 * Shared helper functions for MCP tool servers.
 */

import { queryOne, queryAll } from "../../db/query";
import type { PhaseRow, PlanRow } from "../../db/types";

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/**
 * Render a plan and its phases as formatted markdown.
 */
export function renderPlanMarkdown(planId: number): string {
  return queryOne<PlanRow>("SELECT * FROM plans WHERE id = ?", planId).match({
    Some: (plan) => {
      const phases = queryAll<PhaseRow>(
        "SELECT * FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        planId,
      ).getOr([]);

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
    },
    None: () => "Plan not found.",
  });
}
