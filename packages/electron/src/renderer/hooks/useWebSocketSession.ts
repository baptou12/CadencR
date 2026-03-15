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
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import {
  parseEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
  createInterrupt,
  createDestroy,
  createModelSet,
  createModeSet,
  type SessionConfig,
} from "@/lib/ws-envelope";
import { useGetFeatureAgentState, type AgentBlock } from "@/api/generated";

export type PermissionMode = "acceptEdits" | "plan";

export interface PendingPlanApproval {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

export interface UseWebSocketSessionReturn {
  blocks: AgentBlockData[];
  status: AgentStatus;
  isConnected: boolean;
  sessionId: string;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  pendingQuestions: AgentQuestion[];
  respondToQuestion: (response: string) => void;

  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;
  pendingPlanApproval: PendingPlanApproval | null;
  approvePlan: () => void;
  requestPlanChanges: (feedback: string) => void;

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
  /** Reverse map: tool_use_id → content block index (for O(1) backfill lookup) */
  toolUseIdToIndex: Map<string, number>;
  /** Map of tool_use_id → block reference (for nesting child blocks under Task/Agent) */
  toolUseIdToBlock: Map<string, AgentBlockData>;
  /** Counter for generating unique block IDs */
  counter: number;
  /** parent_tool_use_id from the current stream_event */
  parentToolUseId: string | null;
  /** Set to true when an ExitPlanMode tool_use is detected in the current turn */
  exitPlanModeDetected: boolean;
}

function createStreamingState(): StreamingState {
  return {
    model: null,
    contentBlockIds: new Map(),
    toolUseIds: new Map(),
    toolUseIdToIndex: new Map(),
    toolUseIdToBlock: new Map(),
    counter: 0,
    parentToolUseId: null,
    exitPlanModeDetected: false,
  };
}

type BlockMutation = { action: "append" | "update" | "replace"; block: AgentBlockData };

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
      // Mark previous parent subagent as complete when context changes
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
          // Reset content block tracking for new message
          state.contentBlockIds.clear();
          state.toolUseIds.clear();
          state.toolUseIdToIndex.clear();
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
            const toolName = contentBlock.name as string;
            state.toolUseIds.set(index, toolUseId);
            state.toolUseIdToIndex.set(toolUseId, index);

            // Detect ExitPlanMode tool call (unless suppressed after approval)
            if (toolName === "ExitPlanMode") {
              state.exitPlanModeDetected = true;
            }

            const isSubagent = toolName === "Task" || toolName === "Agent";
            const block: AgentBlockData = {
              id: blockId, type: "tool_call", content: "",
              toolName, toolArgs: "",
              toolUseId, parentToolUseId: parentToolUseId,
              createdAt: new Date().toISOString(),
              ...(isSubagent ? { childBlocks: [] } : {}),
            };
            state.toolUseIdToBlock.set(toolUseId, block);

            return [{ action: "append", block }];
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
      const assistantParentId = (msg.parent_tool_use_id as string) ?? null;

      // Full assistant message. If we already have content from stream events
      // (contentBlockIds is populated) AND this message is from the same context
      // (not a subagent), backfill any tool_call blocks whose args were not
      // fully streamed (e.g. ExitPlanMode sends empty deltas).
      // Subagent messages (different parentToolUseId) skip backfill and create new blocks.
      if (state.contentBlockIds.size > 0 && assistantParentId === state.parentToolUseId) {
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
                block: {
                  id: blockId,
                  type: "tool_call",
                  content: JSON.stringify(cb.input),
                },
              });
            }
          }
          return results;
        }
        return [];
      }

      // No stream events (or subagent context) — extract content blocks directly.
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
          if (toolName === "ExitPlanMode") {
            state.exitPlanModeDetected = true;
          }
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

    case "user": {
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
        const parentId = matchingBlock?.parentToolUseId ?? parentToolUseId;

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

    case "system":
    case "result":
      return [];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Convert server AgentBlock[] to AgentBlockData[]
// ---------------------------------------------------------------------------

function serverBlocksToAgentBlocks(blocks: AgentBlock[]): AgentBlockData[] {
  return blocks.map((b) => ({
    id: b.id,
    type: b.type as AgentBlockData["type"],
    content: b.content,
    toolName: b.toolName,
    toolArgs: b.toolArgs,
    isError: b.isError,
    toolUseId: b.toolUseId,
    parentToolUseId: b.parentToolUseId,
    childBlocks: b.childBlocks ? serverBlocksToAgentBlocks(b.childBlocks) : undefined,
    sourceToolName: b.sourceToolName,
    createdAt: b.createdAt,
    model: b.model,
  }));
}

export function useWebSocketSession(sessionId: string, featureId?: number): UseWebSocketSessionReturn {
  const [blocks, setBlocks] = useState<AgentBlockData[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const persistedLoadedRef = useRef(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const pendingRequestIdRef = useRef<string>("");
  const [pendingQuestions, setPendingQuestions] = useState<AgentQuestion[]>([]);
  const pendingQuestionToolInputRef = useRef<Record<string, unknown>>({});
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>("acceptEdits");
  const [pendingPlanApproval, setPendingPlanApproval] = useState<PendingPlanApproval | null>(null);
  const [currentModelId, setCurrentModelId] = useState<string>("claude-sonnet-4-6");

  // Load persisted state from DB when featureId is provided
  const agentStateQuery = useGetFeatureAgentState(featureId ?? 0, undefined, {
    enabled: !!featureId && !persistedLoadedRef.current,
  });

  useEffect(() => {
    if (persistedLoadedRef.current || !featureId || !agentStateQuery.data) return;
    const sessions = agentStateQuery.data.sessions;
    if (sessions.length === 0) return;

    // Use the last session (most recent)
    const session = sessions[sessions.length - 1];
    persistedLoadedRef.current = true;

    const restoredBlocks = serverBlocksToAgentBlocks(session.blocks);
    if (restoredBlocks.length > 0) {
      setBlocks(restoredBlocks);
    }

    // Restore status
    const s = session.status;
    if (s === "running" || s === "paused" || s === "completed" || s === "error") {
      setStatus(s);
    } else {
      setStatus("idle");
    }
  }, [featureId, agentStateQuery.data]);

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

          // Collect all mutations, then apply in a single state update
          const allMutations: BlockMutation[] = [];
          for (const rawBlock of payload.blocks) {
            if (!rawBlock || typeof rawBlock !== "object") continue;
            const mutations = processSdkMessage(rawBlock as Record<string, unknown>, state);
            allMutations.push(...mutations);
          }

          if (allMutations.length > 0) {
            // Apply nesting and ref mutations OUTSIDE the state updater
            // to avoid double-execution in React Strict Mode.
            const dirtyParents = new Set<string>();
            const rootAppends: AgentBlockData[] = [];
            const rootUpdates: BlockMutation[] = [];

            for (const mut of allMutations) {
              if (mut.action === "append") {
                const parentId = mut.block.parentToolUseId;
                if (parentId) {
                  const parentBlock = state.toolUseIdToBlock.get(parentId);
                  if (parentBlock?.childBlocks) {
                    parentBlock.childBlocks = [...parentBlock.childBlocks, mut.block];
                    dirtyParents.add(parentId);
                    if (mut.block.toolUseId) {
                      state.toolUseIdToBlock.set(mut.block.toolUseId, mut.block);
                    }
                    continue;
                  }
                }
                rootAppends.push(mut.block);
              } else {
                rootUpdates.push(mut);
              }
            }

            // Replace dirty parent blocks with new object references
            for (const parentToolUseId of dirtyParents) {
              const parentBlock = state.toolUseIdToBlock.get(parentToolUseId);
              if (parentBlock) {
                const newParent = { ...parentBlock };
                state.toolUseIdToBlock.set(parentToolUseId, newParent);
                // Mark for replacement in root array
                rootUpdates.push({ action: "replace_parent" as "replace", block: newParent });
              }
            }

            setBlocks((prev) => {
              // Append root-level blocks first so updates can find them
              const result = [...prev, ...rootAppends];

              // Apply updates (content deltas, parent replacements)
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
                  if (existing.type === "tool_call") {
                    existing.toolArgs = existing.content;
                  }
                  result[idx] = existing;
                } else {
                  // Search in nested childBlocks
                  for (const parentBlock of state.toolUseIdToBlock.values()) {
                    if (!parentBlock.childBlocks) continue;
                    const childIdx = parentBlock.childBlocks.findIndex((b) => b.id === mut.block.id);
                    if (childIdx === -1) continue;
                    const child = { ...parentBlock.childBlocks[childIdx] };
                    child.content = mut.action === "replace"
                      ? mut.block.content
                      : child.content + mut.block.content;
                    if (child.type === "tool_call") {
                      child.toolArgs = child.content;
                    }
                    parentBlock.childBlocks[childIdx] = child;
                    break;
                  }
                }
              }

              return result;
            });
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
            pattern?: string;
          };
          pendingRequestIdRef.current = p.request_id;

          if (p.tool_name === "AskUserQuestion") {
            const toolInput = (p.tool_input ?? {}) as Record<string, unknown>;
            pendingQuestionToolInputRef.current = toolInput;
            const questions = parseAskUserQuestions(toolInput);
            setPendingQuestions(questions);
          } else {
            setPendingPermission({
              toolName: p.tool_name,
              input: p.tool_input ?? {},
              description: p.description ?? "",
              pattern: p.pattern ?? "",
            });
          }
          setStatus("paused");
          break;
        }

        case "mode.changed": {
          const p = envelope.payload as { mode?: string };
          if (p.mode === "acceptEdits" || p.mode === "plan") {
            setPermissionModeState(p.mode);
          }
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
        case "turn_complete": {
          const state = streamingStateRef.current;
          // Mark any in-flight subagent as complete
          if (state.parentToolUseId) {
            const parent = state.toolUseIdToBlock.get(state.parentToolUseId);
            if (parent?.childBlocks) parent.taskComplete = true;
            state.parentToolUseId = null;
          }
          if (state.exitPlanModeDetected) {
            state.exitPlanModeDetected = false;
            setPendingPlanApproval({});
            setStatus("paused");
          } else {
            setStatus("idle");
          }
          break;
        }
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
      const decision = granted ? "allow_once" : "deny";
      send(createPermissionRespond(serverSessionIdRef.current, requestId, decision));
      setPendingPermission(null);
      pendingRequestIdRef.current = "";
      setStatus("running");
    },
    [send],
  );

  const respondToQuestion = useCallback(
    (response: string) => {
      const updatedInput = {
        ...pendingQuestionToolInputRef.current,
        answers: { "0": response },
      };
      send(createPermissionRespond(
        serverSessionIdRef.current,
        pendingRequestIdRef.current,
        "allow_once",
        updatedInput,
      ));

      // Show the user's answer as a formatted message in the chat.
      // The response string from AgentQuestionDrawer is:
      //   "Question\nAnswer: answer\n\nQuestion2\nAnswer: answer2"
      // Format with italic questions and bold answers.
      const formatted = response
        .split("\n\n")
        .map((qa) => {
          const lines = qa.split("\n");
          const question = lines[0] ?? "";
          const answer = lines
            .slice(1)
            .map((l) => l.replace(/^Answer:\s*/, ""))
            .join("\n");
          return `*${question}*\n**${answer}**`;
        })
        .join("\n\n");

      streamingStateRef.current.counter += 1;
      setBlocks((prev) => [
        ...prev,
        {
          id: `ws-user-${streamingStateRef.current.counter}`,
          type: "user_message" as const,
          content: formatted,
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ]);

      setPendingQuestions([]);
      pendingQuestionToolInputRef.current = {};
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

  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      send(createModeSet(serverSessionIdRef.current, mode));
      setPermissionModeState(mode);
    },
    [send],
  );

  const approvePlan = useCallback(() => {
    // Switch to acceptEdits and tell the agent the plan is approved
    send(createModeSet(serverSessionIdRef.current, "acceptEdits"));
    setPermissionModeState("acceptEdits");
    setPendingPlanApproval(null);
    // Send a follow-up prompt so the agent knows to proceed
    send(createPromptSend(serverSessionIdRef.current, "Plan approved. Exit plan mode and proceed with execution."));
    setStatus("running");
  }, [send]);

  const requestPlanChanges = useCallback(
    (feedback: string) => {
      setPendingPlanApproval(null);
      // Echo feedback as user message in the conversation
      streamingStateRef.current.counter += 1;
      setBlocks((prev) => [
        ...prev,
        {
          id: `ws-user-${streamingStateRef.current.counter}`,
          type: "user_message" as const,
          content: feedback,
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ]);
      // Send feedback as a follow-up prompt so the agent revises the plan
      send(createPromptSend(serverSessionIdRef.current, feedback));
      setStatus("running");
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
    pendingQuestions,
    respondToQuestion,
    permissionMode,
    setPermissionMode,
    pendingPlanApproval,
    approvePlan,
    requestPlanChanges,
    currentModelId,
    setModel,
    sendPrompt,
    respondToPermission,
    interrupt,
    destroy: destroySession,
    initSession,
  };
}
