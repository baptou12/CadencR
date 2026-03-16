/**
 * Zustand store for WebSocket session connections.
 *
 * Connections are cached by sessionId so that navigating away from a session
 * and back does not create a new WebSocket. Connections are only closed on
 * explicit destroy or when disconnect() is called.
 */

import { create } from "zustand";
import { DEFAULT_MODEL } from "../../shared/models";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/types/agent";
import type { ContextUsageState } from "@/hooks/useContextUsage";
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
  createSessionClear,
  type SessionConfig,
} from "@/lib/ws-envelope";

export type PermissionMode = "acceptEdits" | "plan";

export interface PendingPlanApproval {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

// ---------------------------------------------------------------------------
// Streaming state — tracks in-flight content blocks by index
// ---------------------------------------------------------------------------

interface StreamingState {
  model: string | null;
  contentBlockIds: Map<number, string>;
  toolUseIds: Map<number, string>;
  toolUseIdToIndex: Map<string, number>;
  toolUseIdToBlock: Map<string, AgentBlockData>;
  counter: number;
  parentToolUseId: string | null;
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
// Per-session state
// ---------------------------------------------------------------------------

export interface SessionEntry {
  ws: WebSocket | null;
  isConnected: boolean;
  serverSessionId: string;
  streamingState: StreamingState;
  blocks: AgentBlockData[];
  status: AgentStatus;
  pendingPermission: PendingPermission | null;
  pendingRequestId: string;
  pendingQuestions: AgentQuestion[];
  pendingQuestionToolInput: Record<string, unknown>;
  permissionMode: PermissionMode;
  pendingPlanApproval: PendingPlanApproval | null;
  currentModelId: string;
  persistedLoaded: boolean;
  contextUsage: ContextUsageState | null;
  /** Claude Code CLI session ID (UUID) for --resume */
  claudeSessionId: string;
  hasFileChanges: boolean;
}

function createSessionEntry(): SessionEntry {
  return {
    ws: null,
    isConnected: false,
    serverSessionId: "",
    claudeSessionId: "",
    streamingState: createStreamingState(),
    blocks: [],
    status: "idle",
    pendingPermission: null,
    pendingRequestId: "",
    pendingQuestions: [],
    pendingQuestionToolInput: {},
    permissionMode: "acceptEdits",
    pendingPlanApproval: null,
    currentModelId: DEFAULT_MODEL,
    persistedLoaded: false,
    contextUsage: null,
    hasFileChanges: false,
  };
}

// ---------------------------------------------------------------------------
// Helper: get WS URL
// ---------------------------------------------------------------------------

function getWsUrl(): string {
  const httpUrl = window.api?.rustBackendUrl;
  if (httpUrl) {
    return httpUrl.replace(/^http/, "ws") + "/ws";
  }
  return "ws://localhost:5005/ws";
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface WsSessionStore {
  sessions: Record<string, SessionEntry>;

  /** Ensure a WebSocket connection exists for sessionId. No-op if already connected/connecting. */
  connect: (sessionId: string) => void;
  /** Close and remove a session's WebSocket connection. */
  disconnect: (sessionId: string) => void;

  // Actions
  send: (sessionId: string, data: unknown) => void;
  initSession: (sessionId: string, config: SessionConfig) => void;
  sendPrompt: (sessionId: string, text: string) => void;
  respondToPermission: (sessionId: string, requestId: string, granted: boolean) => void;
  respondToQuestion: (sessionId: string, response: string) => void;
  interrupt: (sessionId: string) => void;
  destroy: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  setModel: (sessionId: string, modelId: string) => void;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  approvePlan: (sessionId: string) => void;
  requestPlanChanges: (sessionId: string, feedback: string) => void;

  // Persisted state restoration
  markPersistedLoaded: (sessionId: string) => void;
  setPersistedState: (sessionId: string, blocks: AgentBlockData[], status: AgentStatus) => void;
}

// ---------------------------------------------------------------------------
// Helper to update a single session in the store
// ---------------------------------------------------------------------------

function updateSession(
  state: WsSessionStore,
  sessionId: string,
  patch: Partial<SessionEntry>,
): Partial<WsSessionStore> {
  const prev = state.sessions[sessionId];
  if (!prev) return {};
  return {
    sessions: {
      ...state.sessions,
      [sessionId]: { ...prev, ...patch },
    },
  };
}

// ---------------------------------------------------------------------------
// Apply block mutations (same logic as the old hook's setBlocks updater)
// ---------------------------------------------------------------------------

function applyMutations(
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
          if (mut.block.toolUseId) {
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
      if (existing.type === "tool_call") {
        existing.toolArgs = existing.content;
      }
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
        if (child.type === "tool_call") {
          child.toolArgs = child.content;
        }
        parentBlock.childBlocks[childIdx] = child;
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useWsSessionStore = create<WsSessionStore>((set, get) => {
  function getSession(sessionId: string): SessionEntry {
    return get().sessions[sessionId] ?? createSessionEntry();
  }

  function sendRaw(sessionId: string, data: unknown) {
    const session = getSession(sessionId);
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(data));
    }
  }

  function handleEnvelope(
    sessionId: string,
    envelope: { domain: string; action: string; payload: unknown },
  ) {
    if (envelope.domain !== "session") return;

    const session = getSession(sessionId);
    const state = session.streamingState;

    switch (envelope.action) {
      case "initialized": {
        const initPayload = envelope.payload as { session_id?: string };
        set(updateSession(get(), sessionId, {
          serverSessionId: initPayload.session_id ?? "",
          status: "idle",
        }));
        break;
      }

      case "claude_session_id": {
        const payload = envelope.payload as { claude_session_id?: string };
        if (payload.claude_session_id && payload.claude_session_id !== getSession(sessionId).claudeSessionId) {
          set(updateSession(get(), sessionId, {
            claudeSessionId: payload.claude_session_id,
          }));
        }
        break;
      }

      case "message": {
        const payload = envelope.payload as { blocks?: unknown[] };
        if (!payload.blocks || !Array.isArray(payload.blocks)) break;

        const allMutations: BlockMutation[] = [];
        for (const rawBlock of payload.blocks) {
          if (!rawBlock || typeof rawBlock !== "object") continue;
          const mutations = processSdkMessage(rawBlock as Record<string, unknown>, state);
          allMutations.push(...mutations);
        }

        if (allMutations.length > 0) {
          const currentSession = getSession(sessionId);
          const newBlocks = applyMutations(currentSession.blocks, allMutations, state);
          const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
          const hasNewFileChange = allMutations.some(
            (m) => m.action === "append" && m.block.type === "tool_call" && m.block.toolName && FILE_CHANGE_TOOLS.has(m.block.toolName),
          );
          const patch: Partial<SessionEntry> = { blocks: newBlocks, status: "running" };
          if (hasNewFileChange) patch.hasFileChanges = true;
          set(updateSession(get(), sessionId, patch));
        } else {
          set(updateSession(get(), sessionId, { status: "running" }));
        }
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

        if (p.tool_name === "AskUserQuestion") {
          const toolInput = (p.tool_input ?? {}) as Record<string, unknown>;
          const questions = parseAskUserQuestions(toolInput);
          set(updateSession(get(), sessionId, {
            pendingRequestId: p.request_id,
            pendingQuestions: questions,
            pendingQuestionToolInput: toolInput,
            status: "paused",
          }));
        } else {
          set(updateSession(get(), sessionId, {
            pendingRequestId: p.request_id,
            pendingPermission: {
              toolName: p.tool_name,
              input: p.tool_input ?? {},
              description: p.description ?? "",
              pattern: p.pattern ?? "",
            },
            status: "paused",
          }));
        }
        break;
      }

      case "mode.changed": {
        const p = envelope.payload as { mode?: string };
        if (p.mode === "acceptEdits" || p.mode === "plan") {
          set(updateSession(get(), sessionId, { permissionMode: p.mode }));
        }
        break;
      }

      case "error": {
        const p = envelope.payload as { message?: string };
        if (p.message) {
          state.counter += 1;
          const currentSession = getSession(sessionId);
          set(updateSession(get(), sessionId, {
            status: "error",
            blocks: [
              ...currentSession.blocks,
              {
                id: `ws-err-${state.counter}`,
                type: "text",
                content: `Error: ${p.message}`,
                isError: true,
              },
            ],
          }));
        } else {
          set(updateSession(get(), sessionId, { status: "error" }));
        }
        break;
      }

      case "cleared": {
        set(updateSession(get(), sessionId, {
          blocks: [],
          status: "idle",
          streamingState: createStreamingState(),
          pendingPermission: null,
          pendingRequestId: "",
          pendingQuestions: [],
          pendingPlanApproval: null,
          hasFileChanges: false,
        }));
        break;
      }

      case "usage_update": {
        const u = envelope.payload as { input_tokens: number; output_tokens: number; context_window: number };
        const totalTokens = u.input_tokens + u.output_tokens;
        const contextWindow = u.context_window || 200000;
        const usageRatio = Math.min(1, totalTokens / contextWindow);
        set(updateSession(get(), sessionId, {
          contextUsage: {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            totalTokens,
            contextWindow,
            usageRatio,
            wasCompacted: false,
          },
        }));
        break;
      }

      case "feature.renamed": {
        const p = envelope.payload as { feature_id?: number; title?: string };
        if (p.feature_id != null && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("ws:feature-renamed", {
              detail: { featureId: p.feature_id, title: p.title },
            }),
          );
        }
        break;
      }

      case "ended":
      case "turn_complete": {
        if (state.parentToolUseId) {
          const parent = state.toolUseIdToBlock.get(state.parentToolUseId);
          if (parent?.childBlocks) parent.taskComplete = true;
          state.parentToolUseId = null;
        }
        if (state.exitPlanModeDetected) {
          state.exitPlanModeDetected = false;
          set(updateSession(get(), sessionId, {
            pendingPlanApproval: {},
            status: "paused",
          }));
        } else {
          set(updateSession(get(), sessionId, { status: "idle" }));
        }
        break;
      }
    }
  }

  return {
    sessions: {},

    connect(sessionId: string) {
      const existing = get().sessions[sessionId];
      if (existing?.ws && (existing.ws.readyState === WebSocket.OPEN || existing.ws.readyState === WebSocket.CONNECTING)) {
        return; // Already connected or connecting
      }

      // Ensure session entry exists
      const entry = existing ?? createSessionEntry();
      const ws = new WebSocket(getWsUrl());

      ws.addEventListener("open", () => {
        set(updateSession(get(), sessionId, { isConnected: true }));
      });

      ws.addEventListener("close", () => {
        set(updateSession(get(), sessionId, {
          isConnected: false,
          status: getSession(sessionId).status === "running" ? "error" : getSession(sessionId).status,
        }));
      });

      ws.addEventListener("error", () => {
        set(updateSession(get(), sessionId, { isConnected: false, status: "error" }));
      });

      ws.addEventListener("message", (event) => {
        try {
          const envelope = parseEnvelope(event.data as string);
          handleEnvelope(sessionId, envelope);
        } catch {
          // Ignore unparseable messages
        }
      });

      set({
        sessions: {
          ...get().sessions,
          [sessionId]: { ...entry, ws, streamingState: existing?.streamingState ?? entry.streamingState },
        },
      });
    },

    disconnect(sessionId: string) {
      const session = get().sessions[sessionId];
      if (!session?.ws) return;

      if (session.ws.readyState === WebSocket.OPEN && session.serverSessionId) {
        session.ws.send(JSON.stringify(createDestroy(session.serverSessionId)));
      }
      session.ws.close();

      const { [sessionId]: _, ...rest } = get().sessions;
      set({ sessions: rest });
    },

    send: sendRaw,

    initSession(sessionId: string, config: SessionConfig) {
      if (config.model) {
        set(updateSession(get(), sessionId, { currentModelId: config.model }));
      }
      sendRaw(sessionId, createSessionInit(config));
    },

    sendPrompt(sessionId: string, text: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createPromptSend(session.serverSessionId, text));

      session.streamingState.counter += 1;
      set(updateSession(get(), sessionId, {
        blocks: [
          ...session.blocks,
          {
            id: `ws-user-${session.streamingState.counter}`,
            type: "user_message" as const,
            content: text,
            isError: false,
            createdAt: new Date().toISOString(),
          },
        ],
        status: "running",
      }));
    },

    respondToPermission(sessionId: string, requestId: string, granted: boolean) {
      const session = getSession(sessionId);
      const decision = granted ? "allow_once" : "deny";
      sendRaw(sessionId, createPermissionRespond(session.serverSessionId, requestId, decision));
      set(updateSession(get(), sessionId, {
        pendingPermission: null,
        pendingRequestId: "",
        status: "running",
      }));
    },

    respondToQuestion(sessionId: string, response: string) {
      const session = getSession(sessionId);
      const updatedInput = {
        ...session.pendingQuestionToolInput,
        answers: { "0": response },
      };
      sendRaw(sessionId, createPermissionRespond(
        session.serverSessionId,
        session.pendingRequestId,
        "allow_once",
        updatedInput,
      ));

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

      session.streamingState.counter += 1;
      set(updateSession(get(), sessionId, {
        blocks: [
          ...session.blocks,
          {
            id: `ws-user-${session.streamingState.counter}`,
            type: "user_message" as const,
            content: formatted,
            isError: false,
            createdAt: new Date().toISOString(),
          },
        ],
        pendingQuestions: [],
        pendingQuestionToolInput: {},
        pendingRequestId: "",
        status: "running",
      }));
    },

    interrupt(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createInterrupt(session.serverSessionId));
    },

    destroy(sessionId: string) {
      const session = get().sessions[sessionId];
      if (!session?.ws) return;

      if (session.ws.readyState === WebSocket.OPEN && session.serverSessionId) {
        session.ws.send(JSON.stringify(createDestroy(session.serverSessionId)));
      }
      session.ws.close();

      set(updateSession(get(), sessionId, {
        ws: null,
        isConnected: false,
        status: "completed",
      }));
    },

    clearSession(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createSessionClear(session.serverSessionId));
    },

    setModel(sessionId: string, modelId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createModelSet(session.serverSessionId, modelId));
      set(updateSession(get(), sessionId, { currentModelId: modelId }));
    },

    setPermissionMode(sessionId: string, mode: PermissionMode) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createModeSet(session.serverSessionId, mode));
      set(updateSession(get(), sessionId, { permissionMode: mode }));
    },

    approvePlan(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
      sendRaw(sessionId, createPromptSend(session.serverSessionId, "Plan approved. Exit plan mode and proceed with execution."));
      set(updateSession(get(), sessionId, {
        permissionMode: "acceptEdits",
        pendingPlanApproval: null,
        status: "running",
      }));
    },

    requestPlanChanges(sessionId: string, feedback: string) {
      const session = getSession(sessionId);
      session.streamingState.counter += 1;
      sendRaw(sessionId, createPromptSend(session.serverSessionId, feedback));
      set(updateSession(get(), sessionId, {
        pendingPlanApproval: null,
        blocks: [
          ...session.blocks,
          {
            id: `ws-user-${session.streamingState.counter}`,
            type: "user_message" as const,
            content: feedback,
            isError: false,
            createdAt: new Date().toISOString(),
          },
        ],
        status: "running",
      }));
    },

    markPersistedLoaded(sessionId: string) {
      set(updateSession(get(), sessionId, { persistedLoaded: true }));
    },

    setPersistedState(sessionId: string, blocks: AgentBlockData[], status: AgentStatus) {
      set(updateSession(get(), sessionId, { blocks, status, persistedLoaded: true }));
    },
  };
});
