/**
 * Block mutation helpers — applying mutations to block arrays,
 * building message patches, and extracting todos.
 */

import type { AgentBlockData } from "@/components/AgentBlock";
import type { TodoItem } from "@/types/agent";
import type { BlockMutation, StreamingState } from "./ws-message-processing";

export type ParsedTodo = TodoItem;

/** Extract todos from the last TodoWrite block in a block list. */
export function parseTodosFromBlocks(blocks: AgentBlockData[]): ParsedTodo[] | undefined {
  const allBlocks = blocks.flatMap((b) => b.childBlocks ? [b, ...b.childBlocks] : [b]);
  for (let i = allBlocks.length - 1; i >= 0; i--) {
    const b = allBlocks[i];
    if (b.type === "tool_call" && b.toolName === "TodoWrite") {
      const argsStr = b.toolArgs || b.content;
      if (!argsStr) return undefined;
      try {
        const parsed = JSON.parse(argsStr);
        if (Array.isArray(parsed?.todos)) {
          return parsed.todos.map((t: Record<string, unknown>) => ({
            content: String(t.content ?? ""),
            status: t.status as TodoItem["status"],
            activeForm: String(t.activeForm ?? ""),
          }));
        }
      } catch { /* Malformed JSON */ }
      return undefined;
    }
  }
  return undefined;
}

const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export interface MessagePatch {
  blocks: AgentBlockData[];
  status: "running";
  hasFileChanges?: boolean;
  todos?: ParsedTodo[];
  permissionMode?: "plan";
}

export function buildMessagePatch(
  newBlocks: AgentBlockData[],
  allMutations: BlockMutation[],
  state: StreamingState,
): MessagePatch {
  const hasNewFileChange = allMutations.some(
    (m) => m.action === "append" && m.block.type === "tool_call" && m.block.toolName && FILE_CHANGE_TOOLS.has(m.block.toolName),
  );

  const mutatedIds = new Set(allMutations.map((m) => m.block.id));
  const todoBlock = findTodoBlock(newBlocks, mutatedIds, allMutations);

  const patch: MessagePatch = { blocks: newBlocks, status: "running" };
  if (hasNewFileChange) patch.hasFileChanges = true;
  if (todoBlock) {
    const todos = parseTodosFromBlocks([todoBlock]);
    if (todos) patch.todos = todos;
  }
  if (state.enterPlanModeDetected) {
    state.enterPlanModeDetected = false;
    patch.permissionMode = "plan";
  }
  return patch;
}

function findTodoBlock(
  newBlocks: AgentBlockData[],
  mutatedIds: Set<string>,
  allMutations: BlockMutation[],
): AgentBlockData | undefined {
  const top = newBlocks.find(
    (b) => b.type === "tool_call" && b.toolName === "TodoWrite" && mutatedIds.has(b.id),
  );
  if (top) return top;
  for (const b of newBlocks) {
    if (!b.childBlocks) continue;
    const child = b.childBlocks.find(
      (c) => c.type === "tool_call" && c.toolName === "TodoWrite" && mutatedIds.has(c.id),
    );
    if (child) return child;
  }
  return allMutations.find(
    (m) => m.block.type === "tool_call" && m.block.toolName === "TodoWrite",
  )?.block;
}

export function applyMutations(
  prevBlocks: AgentBlockData[],
  allMutations: BlockMutation[],
  streamState: StreamingState,
): AgentBlockData[] {
  const dirtyParents = new Set<string>();
  const rootAppends: AgentBlockData[] = [];
  const rootUpdates: BlockMutation[] = [];

  for (const mut of allMutations) {
    if (mut.action === "append") {
      const parentId = mut.block.parentToolUseId;
      if (parentId) {
        const parentBlock = streamState.toolUseIdToBlock.get(parentId);
        if (parentBlock?.childBlocks) {
          parentBlock.childBlocks = [...parentBlock.childBlocks, mut.block];
          dirtyParents.add(parentId);
          if (mut.block.toolUseId && !streamState.toolUseIdToBlock.has(mut.block.toolUseId)) {
            streamState.toolUseIdToBlock.set(mut.block.toolUseId, mut.block);
          }
          continue;
        }
      }
      rootAppends.push(mut.block);
    } else {
      rootUpdates.push(mut);
    }
  }

  for (const parentToolUseId of dirtyParents) {
    const parentBlock = streamState.toolUseIdToBlock.get(parentToolUseId);
    if (parentBlock) {
      const newParent = { ...parentBlock };
      streamState.toolUseIdToBlock.set(parentToolUseId, newParent);
      rootUpdates.push({ action: "replace_parent" as "replace", block: newParent });
    }
  }

  function syncToolUseMap(block: AgentBlockData): void {
    if (block.type !== "tool_call") return;
    try {
      JSON.parse(block.content);
      block.toolArgs = block.content;
      if (block.toolUseId) {
        const canonical = streamState.toolUseIdToBlock.get(block.toolUseId);
        if (canonical && canonical !== block) {
          canonical.toolArgs = block.toolArgs;
          canonical.content = block.content;
        }
      }
    } catch { /* keep previous toolArgs until JSON is complete */ }
  }

  const result = [...prevBlocks, ...rootAppends];

  for (const mut of rootUpdates) {
    if ((mut.action as string) === "replace_parent") {
      const idx = result.findIndex((b) => b.toolUseId === mut.block.toolUseId);
      if (idx !== -1) result[idx] = mut.block;
      continue;
    }
    const idx = result.findIndex((b) => b.id === mut.block.id);
    if (idx !== -1) {
      const existing = { ...result[idx] };
      existing.content = mut.action === "replace"
        ? mut.block.content
        : existing.content + mut.block.content;
      syncToolUseMap(existing);
      result[idx] = existing;
    } else {
      for (const parentBlock of streamState.toolUseIdToBlock.values()) {
        if (!parentBlock.childBlocks) continue;
        const childIdx = parentBlock.childBlocks.findIndex((b) => b.id === mut.block.id);
        if (childIdx === -1) continue;
        const child = { ...parentBlock.childBlocks[childIdx] };
        child.content = mut.action === "replace"
          ? mut.block.content
          : child.content + mut.block.content;
        syncToolUseMap(child);
        parentBlock.childBlocks[childIdx] = child;
        break;
      }
    }
  }

  return result;
}
