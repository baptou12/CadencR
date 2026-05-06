import type { BlockMutation, ParserSignals, StreamingState } from "./ws-message-processing-core";
import { nextSyntheticBlockId } from "./ws-message-processing-utils";

export function processUserMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
  signals: ParserSignals,
): BlockMutation[] {
  const message = msg.message as Record<string, unknown> | undefined;
  const contentArr = message?.content as Array<Record<string, unknown>> | undefined;
  if (!contentArr || !Array.isArray(contentArr)) return [];

  const parentToolUseId = (msg.parent_tool_use_id as string) ?? null;
  const results: BlockMutation[] = [];

  for (const item of contentArr) {
    if (item.type === "compaction") {
      signals.compactBoundaryObserved = true;
      results.push({
        action: "append",
        block: {
          id: nextSyntheticBlockId(state, "ws-compact"),
          type: "compact_divider",
          content: "",
          createdAt: new Date().toISOString(),
        },
      });
      continue;
    }

    if (item.type !== "tool_result") continue;

    const toolUseId = item.tool_use_id as string;
    const matchingBlock = state.toolUseIdToBlock.get(toolUseId);
    const sourceToolName = matchingBlock?.toolName ?? "unknown";
    const isSubagentResult = sourceToolName === "Agent" || sourceToolName === "Task";

    results.push({
      action: "append",
      block: {
        id: nextSyntheticBlockId(state),
        type: "tool_result",
        content:
          typeof item.content === "string" ? item.content : JSON.stringify(item.content ?? ""),
        isError: item.is_error === true,
        sourceToolName,
        toolUseId,
        parentToolUseId: isSubagentResult
          ? toolUseId
          : (matchingBlock?.parentToolUseId ?? parentToolUseId),
        createdAt: new Date().toISOString(),
      },
    });
  }
  return results;
}
