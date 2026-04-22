import type { AgentBlockData } from "@/components/AgentBlock";
import { normalizeToolName } from "@/lib/tool-adapter";

interface ToolBlockState {
  toolUseIdToBlock: Map<string, AgentBlockData>;
}

export function createToolUseBlock(
  state: ToolBlockState,
  blockId: string,
  contentBlock: Record<string, unknown>,
  parentToolUseId: string | null,
  createdAt: string,
  includeInput: boolean,
): AgentBlockData {
  const toolName = normalizeToolName(contentBlock.name as string);

  const toolUseId = contentBlock.id as string;
  const input = includeInput ? JSON.stringify(contentBlock.input ?? {}) : "";
  const block: AgentBlockData = {
    id: blockId,
    type: "tool_call",
    content: input,
    toolName,
    toolArgs: input,
    toolUseId,
    parentToolUseId,
    createdAt,
    ...(toolName === "Task" || toolName === "Agent" ? { childBlocks: [] } : {}),
  };
  state.toolUseIdToBlock.set(toolUseId, block);
  return block;
}
