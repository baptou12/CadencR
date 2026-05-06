/**
 * Build the `updated_input` payload returned to the Claude CLI for an
 * `AskUserQuestion` tool call.
 *
 * The CLI feeds `updated_input` straight back to the model as the tool result,
 * so the shape MUST match Anthropic's `AskUserQuestionOutput`:
 *
 *   {
 *     questions: [...],
 *     answers: { [questionText: string]: string }, // multi-select = comma-separated
 *     annotations?: ...
 *   }
 *
 * Sending any other shape (e.g. `string[][]`, `{ "0": "..." }`) makes the model
 * see an empty/unparseable answer block — the symptom that triggered this fix.
 *
 * See: `node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts`
 *      → `AskUserQuestionOutput`.
 */

import type { AgentQuestionAnswers } from "@/components/AgentQuestionDrawer";

/** Extract the ordered list of question texts from the tool's original input. */
function extractQuestionLabels(toolInput: Record<string, unknown>): string[] {
  const list = toolInput.questions;
  if (Array.isArray(list)) {
    return list.map((q) => {
      if (typeof q === "object" && q !== null) {
        const text = (q as Record<string, unknown>).question;
        if (typeof text === "string") return text;
      }
      return "";
    });
  }
  if (typeof toolInput.question === "string") return [toolInput.question];
  return [];
}

/**
 * Convert the drawer's `string[][]` response (one inner array per question
 * holding the selected option labels and/or free-text "Other" entry) into the
 * `updated_input` payload the CLI expects.
 */
export function buildAskUserQuestionUpdatedInput(
  toolInput: Record<string, unknown>,
  response: AgentQuestionAnswers,
): Record<string, unknown> {
  const labels = extractQuestionLabels(toolInput);
  const answers: Record<string, string> = {};
  response.forEach((selected, index) => {
    const key = labels[index] && labels[index].length > 0 ? labels[index] : `Question ${index + 1}`;
    answers[key] = selected.join(", ");
  });
  return { ...toolInput, answers };
}
