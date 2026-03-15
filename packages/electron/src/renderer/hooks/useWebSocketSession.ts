/**
 * WebSocket session hook — replaces useFeatureAgentState + useAgentChat
 * for ephemeral WebSocket sessions backed by the Rust Axum service.
 *
 * Provides the same data shape consumed by AgentSession/AgentStream/AgentPromptBar.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import {
  parseEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
  createInterrupt,
  createDestroy,
  createModelSet,
  type SessionConfig,
} from "@/lib/ws-envelope";

export interface UseWebSocketSessionReturn {
  blocks: AgentBlockData[];
  status: AgentStatus;
  isConnected: boolean;
  sessionId: string;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;

  currentModelId: string;
  setModel: (modelId: string) => void;
  sendPrompt: (text: string) => void;
  respondToPermission: (requestId: string, granted: boolean) => void;
  interrupt: () => void;
  destroy: () => void;
  initSession: (config: SessionConfig) => void;
}

function getWsUrl(): string {
  const httpUrl = window.api?.rustBackendUrl;
  if (httpUrl) {
    return httpUrl.replace(/^http/, "ws") + "/ws";
  }
  return "ws://localhost:5005/ws";
}

// ---------------------------------------------------------------------------
// Streaming state — tracks in-flight content blocks by index
// ---------------------------------------------------------------------------

interface StreamingState {
  /** Current model (from message_start) */
  model: string | null;
  /** Map of content block index → block ID in the blocks array */
  contentBlockIds: Map<number, string>;
  /** Map of content block index → tool_use_id (for input_json_delta) */
  toolUseIds: Map<number, string>;
  /** Counter for generating unique block IDs */
  counter: number;
  /** parent_tool_use_id from the current stream_event */
  parentToolUseId: string | null;
}

function createStreamingState(): StreamingState {
  return {
    model: null,
    contentBlockIds: new Map(),
    toolUseIds: new Map(),
    counter: 0,
    parentToolUseId: null,
  };
}

type BlockMutation = { action: "append" | "update"; block: AgentBlockData };

/**
 * Process a raw SDK message and return block mutations to apply.
 * Returns empty array if the message should be skipped.
 */
function processSdkMessage(
  msg: Record<string, unknown>,
  state: StreamingState,
): BlockMutation[] {
  if (!msg || typeof msg !== "object") return [];

  const type = msg.type as string;

  switch (type) {
    case "stream_event": {
      const event = msg.event as Record<string, unknown> | undefined;
      if (!event) return [];

      const parentToolUseId = (msg.parent_tool_use_id as string) ?? null;
      state.parentToolUseId = parentToolUseId;

      const eventType = event.type as string;

      switch (eventType) {
        case "message_start": {
          const message = event.message as Record<string, unknown> | undefined;
          if (message?.model) {
            state.model = message.model as string;
          }
          // Reset content block tracking for new message
          state.contentBlockIds.clear();
          state.toolUseIds.clear();
          return [];
        }

        case "content_block_start": {
          const index = event.index as number;
          const contentBlock = event.content_block as Record<string, unknown> | undefined;
          if (!contentBlock) return [];

          const blockType = contentBlock.type as string;
          state.counter += 1;
          const blockId = `ws-${state.counter}`;
          state.contentBlockIds.set(index, blockId);

          if (blockType === "tool_use") {
            const toolUseId = contentBlock.id as string;
            state.toolUseIds.set(index, toolUseId);
            return [{
              action: "append",
              block: {
                id: blockId, type: "tool_call", content: "",
                toolName: contentBlock.name as string, toolArgs: "",
                toolUseId, parentToolUseId: parentToolUseId,
                createdAt: new Date().toISOString(),
              },
            }];
          }

          if (blockType === "thinking") {
            return [{
              action: "append",
              block: { id: blockId, type: "thinking", content: "", parentToolUseId: parentToolUseId, createdAt: new Date().toISOString() },
            }];
          }

          if (blockType === "text") {
            return [{
              action: "append",
              block: { id: blockId, type: "text", content: "", parentToolUseId: parentToolUseId, model: state.model ?? undefined, createdAt: new Date().toISOString() },
            }];
          }

          return [];
        }

        case "content_block_delta": {
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

        default:
          return [];
      }
    }

    case "assistant": {
      // Full assistant message. If we already have content from stream events
      // (contentBlockIds is populated), skip to avoid duplication.
      if (state.contentBlockIds.size > 0) return [];

      // No stream events — extract content blocks directly as fallback.
      const assistantMsg = msg.message as Record<string, unknown> | undefined;
      if (!assistantMsg) return [];
      const contentArr = assistantMsg.content as Array<Record<string, unknown>> | undefined;
      if (!contentArr || !Array.isArray(contentArr)) return [];

      const results: BlockMutation[] = [];
      const model = (assistantMsg.model as string) ?? state.model ?? undefined;
      const parentId = (msg.parent_tool_use_id as string) ?? null;
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
          results.push({
            action: "append",
            block: {
              id: blockId, type: "tool_call",
              content: JSON.stringify(cb.input ?? {}),
              toolName: cb.name as string, toolArgs: JSON.stringify(cb.input ?? {}),
              toolUseId: cb.id as string, parentToolUseId: parentId, createdAt: now,
            },
          });
        }
      }
      return results;
    }

    case "system":
    case "result":
      return [];

    default:
      return [];
  }
}

export function useWebSocketSession(sessionId: string): UseWebSocketSessionReturn {
  const [blocks, setBlocks] = useState<AgentBlockData[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const pendingRequestIdRef = useRef<string>("");
  const [currentModelId, setCurrentModelId] = useState<string>("claude-sonnet-4-6");

  const wsRef = useRef<WebSocket | null>(null);
  const serverSessionIdRef = useRef<string>("");
  const streamingStateRef = useRef<StreamingState>(createStreamingState());

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    streamingStateRef.current = createStreamingState();

    ws.addEventListener("open", () => {
      setIsConnected(true);
    });

    ws.addEventListener("close", () => {
      setIsConnected(false);
      setStatus((prev) => (prev === "running" ? "error" : prev));
    });

    ws.addEventListener("error", () => {
      setIsConnected(false);
      setStatus("error");
    });

    ws.addEventListener("message", (event) => {
      try {
        const envelope = parseEnvelope(event.data as string);
        handleEnvelope(envelope);
      } catch {
        // Ignore unparseable messages
      }
    });

    function handleEnvelope(envelope: { domain: string; action: string; payload: unknown }) {
      if (envelope.domain !== "session") return;

      switch (envelope.action) {
        case "initialized": {
          const initPayload = envelope.payload as { session_id?: string };
          if (initPayload.session_id) {
            serverSessionIdRef.current = initPayload.session_id;
          }
          setStatus("idle");
          break;
        }

        case "message": {
          const payload = envelope.payload as { blocks?: unknown[] };
          if (!payload.blocks || !Array.isArray(payload.blocks)) break;

          const state = streamingStateRef.current;

          for (const rawBlock of payload.blocks) {
            if (!rawBlock || typeof rawBlock !== "object") continue;
            const mutations = processSdkMessage(rawBlock as Record<string, unknown>, state);

            for (const mut of mutations) {
              if (mut.action === "append") {
                setBlocks((prev) => [...prev, mut.block]);
              } else if (mut.action === "update") {
                // Append delta content to existing block by ID
                setBlocks((prev) => {
                  const idx = prev.findIndex((b) => b.id === mut.block.id);
                  if (idx === -1) return prev;
                  const updated = [...prev];
                  const existing = { ...updated[idx] };
                  existing.content += mut.block.content;
                  if (existing.type === "tool_call") {
                    existing.toolArgs = existing.content;
                  }
                  updated[idx] = existing;
                  return updated;
                });
              }
            }
          }

          setStatus("running");
          break;
        }

        case "permission.request": {
          const p = envelope.payload as {
            request_id: string;
            tool_name: string;
            tool_input: Record<string, unknown>;
            description?: string;
          };
          pendingRequestIdRef.current = p.request_id;
          setPendingPermission({
            toolName: p.tool_name,
            input: p.tool_input ?? {},
            description: p.description ?? "",
            pattern: "",
          });
          setStatus("paused");
          break;
        }

        case "error": {
          setStatus("error");
          const p = envelope.payload as { message?: string };
          if (p.message) {
            streamingStateRef.current.counter += 1;
            setBlocks((prev) => [
              ...prev,
              {
                id: `ws-err-${streamingStateRef.current.counter}`,
                type: "text",
                content: `Error: ${p.message}`,
                isError: true,
              },
            ]);
          }
          break;
        }

        case "ended":
          setStatus("idle");
          break;

        case "turn_complete":
          setStatus("idle");
          break;
      }
    }

    return () => {
      // Send destroy before closing
      if (ws.readyState === WebSocket.OPEN && serverSessionIdRef.current) {
        ws.send(JSON.stringify(createDestroy(serverSessionIdRef.current)));
      }
      ws.close();
    };
  }, [sessionId]);

  const initSession = useCallback(
    (config: SessionConfig) => {
      send(createSessionInit(config));
    },
    [send],
  );

  const sendPrompt = useCallback(
    (text: string) => {
      send(createPromptSend(serverSessionIdRef.current, text));
      // Echo user message locally so it appears immediately
      streamingStateRef.current.counter += 1;
      setBlocks((prev) => [
        ...prev,
        {
          id: `ws-user-${streamingStateRef.current.counter}`,
          type: "user_message" as const,
          content: text,
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      setStatus("running");
    },
    [send],
  );

  const respondToPermission = useCallback(
    (requestId: string, granted: boolean) => {
      send(createPermissionRespond(serverSessionIdRef.current, requestId, granted));
      setPendingPermission(null);
      pendingRequestIdRef.current = "";
      setStatus("running");
    },
    [send],
  );

  const interrupt = useCallback(() => {
    send(createInterrupt(serverSessionIdRef.current));
  }, [send]);

  const setModel = useCallback(
    (modelId: string) => {
      send(createModelSet(serverSessionIdRef.current, modelId));
      setCurrentModelId(modelId);
    },
    [send],
  );

  const destroySession = useCallback(() => {
    send(createDestroy(serverSessionIdRef.current));
    setStatus("completed");
  }, [send]);

  return {
    blocks,
    status,
    isConnected,
    sessionId,
    pendingPermission,
    pendingRequestId: pendingRequestIdRef.current,
    currentModelId,
    setModel,
    sendPrompt,
    respondToPermission,
    interrupt,
    destroy: destroySession,
    initSession,
  };
}
