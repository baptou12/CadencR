/**
 * Pure functions for processing WebSocket SDK messages into block mutations.
 *
 * These are stateless transforms — they read/write a StreamingState struct
 * but never touch Zustand or the DOM.
 */

import type { AgentBlockData } from "@/components/AgentBlock";

// Streaming state — tracks in-flight content blocks by index

export interface StreamingState {
  model: string | null;
  contentBlockIds: Map<number, string>;
  toolUseIds: Map<number, string>;
  toolUseIdToIndex: Map<string, number>;
  toolUseIdToBlock: Map<string, AgentBlockData>;
  counter: number;
  parentToolUseId: string | null;
  exitPlanModeDetected: boolean;
  enterPlanModeDetected: boolean;
}

export function createStreamingState(): StreamingState {
  return {
    model: null,
    contentBlockIds: new Map(),
    toolUseIds: new Map(),
    toolUseIdToIndex: new Map(),
    toolUseIdToBlock: new Map(),
    counter: 0,
    parentToolUseId: null,
    exitPlanModeDetected: false,
    enterPlanModeDetected: false,
  };
}

export type BlockMutation = { action: "append" | "update" | "replace"; block: AgentBlockData };

// processSdkMessage — parse a single SDK message into BlockMutations

export function processSdkMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  if (!msg || typeof msg !== "object") return [];

  const type = msg.type as string;

  switch (type) {
    case "stream_event":
      return processStreamEvent(msg, state);

    case "assistant":
      return processAssistantMessage(msg, state);

    case "user":
      return processUserMessage(msg, state);

    case "system":
    case "result":
      return [];

    default:
      return [];
  }
}

// stream_event processing

function processStreamEvent(
  msg: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  const event = msg.event as Record<string, unknown> | undefined;
  if (!event) return [];

  const parentToolUseId = (msg.parent_tool_use_id as string) ?? null;
  if (state.parentToolUseId && state.parentToolUseId !== parentToolUseId) {
    const prevParent = state.toolUseIdToBlock.get(state.parentToolUseId);
    if (prevParent?.childBlocks) {
      prevParent.taskComplete = true;
    }
  }
  state.parentToolUseId = parentToolUseId;

  const eventType = event.type as string;

  switch (eventType) {
    case "message_start": {
      const message = event.message as Record<string, unknown> | undefined;
      if (message?.model) {
        state.model = message.model as string;
      }
      state.contentBlockIds.clear();
      state.toolUseIds.clear();
      state.toolUseIdToIndex.clear();
      return [];
    }

    case "content_block_start":
      return processContentBlockStart(event, state, parentToolUseId);

    case "content_block_delta":
      return processContentBlockDelta(event, state);

    default:
      return [];
  }
}

function processContentBlockStart(
  event: Record<string, unknown>,
  state: StreamingState,
  parentToolUseId: string | null,
): BlockMutation[] {
  const index = event.index as number;
  const contentBlock = event.content_block as Record<string, unknown> | undefined;
  if (!contentBlock) return [];

  const blockType = contentBlock.type as string;
  state.counter += 1;
  const blockId = `ws-${state.counter}`;
  state.contentBlockIds.set(index, blockId);

  if (blockType === "tool_use") {
    const toolUseId = contentBlock.id as string;
    const toolName = contentBlock.name as string;
    state.toolUseIds.set(index, toolUseId);
    state.toolUseIdToIndex.set(toolUseId, index);

    if (toolName === "ExitPlanMode") state.exitPlanModeDetected = true;
    if (toolName === "EnterPlanMode") state.enterPlanModeDetected = true;

    const isSubagent = toolName === "Task" || toolName === "Agent";
    const block: AgentBlockData = {
      id: blockId, type: "tool_call", content: "",
      toolName, toolArgs: "",
      toolUseId, parentToolUseId,
      createdAt: new Date().toISOString(),
      ...(isSubagent ? { childBlocks: [] } : {}),
    };
    state.toolUseIdToBlock.set(toolUseId, block);
    return [{ action: "append", block }];
  }

  if (blockType === "thinking") {
    return [{
      action: "append",
      block: { id: blockId, type: "thinking", content: "", parentToolUseId, createdAt: new Date().toISOString() },
    }];
  }

  if (blockType === "text") {
    return [{
      action: "append",
      block: { id: blockId, type: "text", content: "", parentToolUseId, model: state.model ?? undefined, createdAt: new Date().toISOString() },
    }];
  }

  return [];
}

function processContentBlockDelta(
  event: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  const index = event.index as number;
  const delta = event.delta as Record<string, unknown> | undefined;
  if (!delta) return [];

  const blockId = state.contentBlockIds.get(index);
  if (!blockId) return [];

  const deltaType = delta.type as string;

  if (deltaType === "text_delta") {
    return [{ action: "update", block: { id: blockId, type: "text", content: delta.text as string } }];
  }
  if (deltaType === "thinking_delta") {
    return [{ action: "update", block: { id: blockId, type: "thinking", content: delta.thinking as string } }];
  }
  if (deltaType === "input_json_delta") {
    return [{ action: "update", block: { id: blockId, type: "tool_call", content: delta.partial_json as string } }];
  }

  return [];
}

// assistant message processing

function processAssistantMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  const assistantParentId = (msg.parent_tool_use_id as string) ?? null;

  if (state.contentBlockIds.size > 0 && assistantParentId === state.parentToolUseId) {
    return processAssistantReplace(msg, state);
  }

  const assistantMsg = msg.message as Record<string, unknown> | undefined;
  if (!assistantMsg) return [];
  const contentArr = assistantMsg.content as Array<Record<string, unknown>> | undefined;
  if (!contentArr || !Array.isArray(contentArr)) return [];

  const results: BlockMutation[] = [];
  const model = (assistantMsg.model as string) ?? state.model ?? undefined;
  const parentId = assistantParentId;
  const now = new Date().toISOString();

  for (const cb of contentArr) {
    state.counter += 1;
    const blockId = `ws-${state.counter}`;
    const cbType = cb.type as string;

    if (cbType === "text") {
      results.push({ action: "append", block: { id: blockId, type: "text", content: cb.text as string, model, parentToolUseId: parentId, createdAt: now } });
    } else if (cbType === "thinking") {
      results.push({ action: "append", block: { id: blockId, type: "thinking", content: cb.thinking as string, parentToolUseId: parentId, createdAt: now } });
    } else if (cbType === "tool_use") {
      const toolName = cb.name as string;
      if (toolName === "ExitPlanMode") state.exitPlanModeDetected = true;
      if (toolName === "EnterPlanMode") state.enterPlanModeDetected = true;
      const isSubagent = toolName === "Task" || toolName === "Agent";
      const toolBlock: AgentBlockData = {
        id: blockId, type: "tool_call",
        content: JSON.stringify(cb.input ?? {}),
        toolName, toolArgs: JSON.stringify(cb.input ?? {}),
        toolUseId: cb.id as string, parentToolUseId: parentId, createdAt: now,
        ...(isSubagent ? { childBlocks: [] } : {}),
      };
      state.toolUseIdToBlock.set(cb.id as string, toolBlock);
      results.push({ action: "append", block: toolBlock });
    }
  }
  return results;
}

function processAssistantReplace(
  msg: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  const assistantMsg = msg.message as Record<string, unknown> | undefined;
  const contentArr = assistantMsg?.content as Array<Record<string, unknown>> | undefined;
  if (contentArr && Array.isArray(contentArr)) {
    const results: BlockMutation[] = [];
    for (const cb of contentArr) {
      if (cb.type === "tool_use" && cb.id && cb.input) {
        const idx = state.toolUseIdToIndex.get(cb.id as string);
        if (idx === undefined) continue;
        const blockId = state.contentBlockIds.get(idx);
        if (!blockId) continue;
        results.push({
          action: "replace",
          block: { id: blockId, type: "tool_call", content: JSON.stringify(cb.input) },
        });
      }
    }
    return results;
  }
  return [];
}

// user message processing (tool_results)

function processUserMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  const message = msg.message as Record<string, unknown> | undefined;
  const contentArr = message?.content as Array<Record<string, unknown>> | undefined;
  if (!contentArr || !Array.isArray(contentArr)) return [];

  const parentToolUseId = (msg.parent_tool_use_id as string) ?? null;
  const results: BlockMutation[] = [];

  for (const item of contentArr) {
    if (item.type !== "tool_result") continue;

    const toolUseId = item.tool_use_id as string;
    const content = typeof item.content === "string"
      ? item.content
      : JSON.stringify(item.content ?? "");
    const isError = item.is_error === true;

    const matchingBlock = state.toolUseIdToBlock.get(toolUseId);
    const sourceToolName = matchingBlock?.toolName ?? "unknown";
    const isSubagentResult = sourceToolName === "Agent" || sourceToolName === "Task";
    const parentId = isSubagentResult
      ? toolUseId
      : (matchingBlock?.parentToolUseId ?? parentToolUseId);

    state.counter += 1;
    results.push({
      action: "append",
      block: {
        id: `ws-${state.counter}`,
        type: "tool_result",
        content,
        isError,
        sourceToolName,
        toolUseId,
        parentToolUseId: parentId,
        createdAt: new Date().toISOString(),
      },
    });
  }
  return results;
}

// Re-export block mutation helpers for existing consumers
export { applyMutations, buildMessagePatch, parseTodosFromBlocks } from "./ws-block-mutations";
export type { MessagePatch, ParsedTodo } from "./ws-block-mutations";

// ---------------------------------------------------------------------------
// Plan injection for app restart
// ---------------------------------------------------------------------------

function isPlanToolCall(block: AgentBlockData): boolean {
  return block.type === "tool_call" && (
    block.toolName === "ExitPlanMode" ||
    !!block.toolName?.endsWith("__show_plan") ||
    !!block.toolName?.endsWith("__show_prd")
  );
}

/** Inject plan content from pendingPlanApproval into the last plan tool_call block's toolArgs. */
export function injectPlanIntoBlocks(
  blocks: AgentBlockData[],
  pendingPlanApproval: { plan?: string } | null | undefined,
): AgentBlockData[] {
  if (!pendingPlanApproval?.plan) return blocks;

  let targetIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (isPlanToolCall(blocks[i])) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) return blocks;

  const block = blocks[targetIdx];
  try {
    const existing = JSON.parse(block.toolArgs ?? "{}") as Record<string, unknown>;
    if (typeof existing.plan === "string") return blocks;
    existing.plan = pendingPlanApproval.plan;
    const updated = [...blocks];
    updated[targetIdx] = { ...block, toolArgs: JSON.stringify(existing) };
    return updated;
  } catch {
    return blocks;
  }
}
