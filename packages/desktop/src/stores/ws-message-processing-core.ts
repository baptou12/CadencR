import type { AgentBlockData } from "@/components/AgentBlock";
import { normalizeToolName } from "@/lib/tool-adapter";
import { createToolUseBlock } from "./ws-message-processing-tool-blocks";
import { processSystemMessage } from "./ws-message-processing-system";
import { processUserMessage } from "./ws-message-processing-user";
import { nextSyntheticBlockId } from "./ws-message-processing-utils";

export { isRecord } from "./ws-message-processing-utils";

interface StreamContext {
  model: string | null;
  contentBlockIds: Map<number, string>;
  parentToolUseId: string | null;
}

type StreamSessionId = string | symbol;

const DEFAULT_STREAM_SESSION_ID: StreamSessionId = Symbol("default-stream-session");

export interface StreamingState {
  streams: Map<StreamSessionId, StreamContext>;
  toolUseIdToBlock: Map<string, AgentBlockData>;
  counter: number;
  /**
   * Live mirror of the root-level (non-child) blocks. Maintained in sync with
   * the conversation by `applyMutations` so consumers can read the
   * already-filtered list in O(1) instead of scanning the full block array on
   * every streamed chunk.
   */
  rootBlocks: AgentBlockData[];
  /** Index from `block.id` to its position in `rootBlocks`. */
  rootBlockPosById: Map<string, number>;
  /** Map from a tool_call's `toolUseId` to its matching `tool_result` block. */
  toolResultMap: Map<string, AgentBlockData>;
}

export interface ParserSignals {
  enterPlanModeRequested: boolean;
  /** Set when a `system.compact_boundary` message arrives mid-stream. */
  compactBoundaryObserved: boolean;
  compactBoundaryTrigger: string | null;
}

export interface MessageProcessingResult {
  mutations: BlockMutation[];
  signals: ParserSignals;
}

export type BlockMutation = {
  action: "append" | "update" | "replace";
  block: AgentBlockData;
};

export function createStreamingState(): StreamingState {
  return {
    streams: new Map(),
    toolUseIdToBlock: new Map(),
    counter: 0,
    rootBlocks: [],
    rootBlockPosById: new Map(),
    toolResultMap: new Map(),
  };
}

function createParserSignals(): ParserSignals {
  return {
    enterPlanModeRequested: false,
    compactBoundaryObserved: false,
    compactBoundaryTrigger: null,
  };
}

export function processSdkMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
): MessageProcessingResult {
  if (!msg || typeof msg !== "object") {
    return { mutations: [], signals: createParserSignals() };
  }

  const signals = createParserSignals();

  switch (msg.type as string) {
    case "stream_event":
      return { mutations: processStreamEvent(msg, state), signals };
    case "assistant":
      return { mutations: processAssistantMessage(msg, state, signals), signals };
    case "user":
      return { mutations: processUserMessage(msg, state, signals), signals };
    case "system":
      return { mutations: processSystemMessage(msg, state, signals), signals };
    case "result":
    default:
      return { mutations: [], signals };
  }
}

function processStreamEvent(msg: Record<string, unknown>, state: StreamingState): BlockMutation[] {
  const event = msg.event as Record<string, unknown> | undefined;
  if (!event) return [];

  const stream = getOrCreateStreamContext(state, getStreamSessionId(msg));
  // The server stamps the active model onto every forwarded stream event. Seed
  // `stream.model` from it so a client that missed `message_start` (e.g. a
  // remote device that joined the turn late) still labels streamed text with
  // the right model instead of "unknown".
  if (typeof msg.model === "string") {
    stream.model = msg.model;
  }
  const parentToolUseId = (msg.parent_tool_use_id as string) ?? null;
  if (stream.parentToolUseId && stream.parentToolUseId !== parentToolUseId) {
    const prevParent = state.toolUseIdToBlock.get(stream.parentToolUseId);
    if (prevParent?.childBlocks) {
      prevParent.taskComplete = true;
    }
  }
  stream.parentToolUseId = parentToolUseId;

  switch (event.type as string) {
    case "message_start": {
      const message = event.message as Record<string, unknown> | undefined;
      if (message?.model) {
        stream.model = message.model as string;
      }
      stream.contentBlockIds.clear();
      return [];
    }
    case "content_block_start":
      return processContentBlockStart(
        event,
        state,
        stream,
        parentToolUseId,
        blockIdFromAgentMessage(msg),
      );
    case "content_block_delta":
      return processContentBlockDelta(event, stream, blockIdFromAgentMessage(msg));
    default:
      return [];
  }
}

function processContentBlockStart(
  event: Record<string, unknown>,
  state: StreamingState,
  stream: StreamContext,
  parentToolUseId: string | null,
  persistedBlockId: string | null,
): BlockMutation[] {
  const index = event.index as number;
  const contentBlock = event.content_block as Record<string, unknown> | undefined;
  if (!contentBlock) return [];

  const blockId = persistedBlockId ?? nextSyntheticBlockId(state);
  stream.contentBlockIds.set(index, blockId);

  switch (contentBlock.type as string) {
    case "tool_use":
      return [
        {
          action: "append",
          block: createToolUseBlock(
            state,
            blockId,
            contentBlock,
            parentToolUseId,
            new Date().toISOString(),
            false,
          ),
        },
      ];
    case "thinking":
      return [
        {
          action: "append",
          block: {
            id: blockId,
            type: "thinking",
            content: typeof contentBlock.thinking === "string" ? contentBlock.thinking : "",
            parentToolUseId,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    case "text":
      return [
        {
          action: "append",
          block: {
            id: blockId,
            type: "text",
            content: typeof contentBlock.text === "string" ? contentBlock.text : "",
            parentToolUseId,
            model: stream.model ?? undefined,
            createdAt: new Date().toISOString(),
          },
        },
      ];
    default:
      return [];
  }
}

function processContentBlockDelta(
  event: Record<string, unknown>,
  stream: StreamContext,
  persistedBlockId: string | null,
): BlockMutation[] {
  const index = event.index as number;
  const delta = event.delta as Record<string, unknown> | undefined;
  if (!delta) return [];

  const blockId = persistedBlockId ?? stream.contentBlockIds.get(index);
  if (!blockId) return [];
  if (persistedBlockId) {
    stream.contentBlockIds.set(index, persistedBlockId);
  }

  switch (delta.type as string) {
    case "text_delta":
      return [
        { action: "update", block: { id: blockId, type: "text", content: delta.text as string } },
      ];
    case "thinking_delta":
      return [
        {
          action: "update",
          block: { id: blockId, type: "thinking", content: delta.thinking as string },
        },
      ];
    case "input_json_delta":
      return [
        {
          action: "update",
          block: {
            id: blockId,
            type: "tool_call",
            content: delta.partial_json as string,
          },
        },
      ];
    default:
      return [];
  }
}

function blockIdFromAgentMessage(msg: Record<string, unknown>): string | null {
  const rawId = msg.agent_message_id;
  if (typeof rawId === "number" && Number.isSafeInteger(rawId)) {
    return `msg-${rawId}`;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId)) {
    return `msg-${rawId}`;
  }
  return null;
}

function processAssistantMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
  signals: ParserSignals,
): BlockMutation[] {
  const assistantMsg = msg.message as Record<string, unknown> | undefined;
  const contentArr = assistantMsg?.content as Array<Record<string, unknown>> | undefined;
  if (!contentArr || !Array.isArray(contentArr)) return [];

  const stream = getOrCreateStreamContext(state, getStreamSessionId(msg));
  const assistantParentId = (msg.parent_tool_use_id as string) ?? null;
  const referencesKnownToolUse = contentArr.some(
    (cb) =>
      cb.type === "tool_use" &&
      typeof cb.id === "string" &&
      state.toolUseIdToBlock.has(cb.id as string),
  );

  if (
    (stream.contentBlockIds.size > 0 && assistantParentId === stream.parentToolUseId) ||
    referencesKnownToolUse
  ) {
    return processAssistantReplace(contentArr, state);
  }

  const model = (assistantMsg?.model as string | undefined) ?? stream.model ?? undefined;
  const now = new Date().toISOString();
  const results: BlockMutation[] = [];

  for (const contentBlock of contentArr) {
    const mutation = createAssistantMutation(
      contentBlock,
      state,
      signals,
      model,
      assistantParentId,
      now,
    );
    if (mutation) {
      results.push(mutation);
    }
  }
  return results;
}

function processAssistantReplace(
  contentArr: Array<Record<string, unknown>>,
  state: StreamingState,
): BlockMutation[] {
  const results: BlockMutation[] = [];
  for (const contentBlock of contentArr) {
    if (
      contentBlock.type !== "tool_use" ||
      typeof contentBlock.id !== "string" ||
      contentBlock.input === undefined
    ) {
      continue;
    }

    const blockId = state.toolUseIdToBlock.get(contentBlock.id)?.id;
    if (!blockId) continue;

    results.push({
      action: "replace",
      block: {
        id: blockId,
        type: "tool_call",
        content: JSON.stringify(contentBlock.input),
      },
    });
  }
  return results;
}

function createAssistantMutation(
  contentBlock: Record<string, unknown>,
  state: StreamingState,
  signals: ParserSignals,
  model: string | undefined,
  parentToolUseId: string | null,
  createdAt: string,
): BlockMutation | null {
  const blockId = nextSyntheticBlockId(state);

  switch (contentBlock.type as string) {
    case "text":
      return {
        action: "append",
        block: {
          id: blockId,
          type: "text",
          content: contentBlock.text as string,
          model,
          parentToolUseId,
          createdAt,
        },
      };
    case "thinking":
      return {
        action: "append",
        block: {
          id: blockId,
          type: "thinking",
          content: contentBlock.thinking as string,
          parentToolUseId,
          createdAt,
        },
      };
    case "tool_use":
      if (normalizeToolName(contentBlock.name as string) === "EnterPlanMode") {
        signals.enterPlanModeRequested = true;
      }
      return {
        action: "append",
        block: createToolUseBlock(state, blockId, contentBlock, parentToolUseId, createdAt, true),
      };
    default:
      return null;
  }
}

function getStreamSessionId(msg: Record<string, unknown>): StreamSessionId {
  return typeof msg.session_id === "string" ? msg.session_id : DEFAULT_STREAM_SESSION_ID;
}

function getOrCreateStreamContext(
  state: StreamingState,
  streamSessionId: StreamSessionId,
): StreamContext {
  const existing = state.streams.get(streamSessionId);
  if (existing) {
    return existing;
  }

  const created: StreamContext = {
    model: null,
    contentBlockIds: new Map(),
    parentToolUseId: null,
  };
  state.streams.set(streamSessionId, created);
  return created;
}
