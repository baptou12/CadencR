import type { AgentBlockData } from "@/components/AgentBlock";
import { isFileChangeTool, normalizeToolName } from "@/lib/tool-adapter";

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
  const rawToolName = typeof contentBlock.name === "string" ? contentBlock.name : "unknown";
  const toolName = normalizeToolName(rawToolName);

  const toolUseId = contentBlock.id as string;
  const input = initialToolInput(toolName, contentBlock.input, includeInput);
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

function initialToolInput(toolName: string, input: unknown, includeInput: boolean): string {
  if (includeInput) return JSON.stringify(input ?? {});
  if (!shouldKeepInitialToolInput(toolName) || !isNonEmptyRecord(input)) return "";
  return JSON.stringify(input);
}

function shouldKeepInitialToolInput(toolName: string): boolean {
  return toolName === "Bash" || toolName === "TodoWrite" || isFileChangeTool(toolName);
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length > 0;
}
