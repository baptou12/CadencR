/**
 * Zustand store for WebSocket session connections.
 *
 * Connections are cached by sessionId so that navigating away from a session
 * and back does not create a new WebSocket. Connections are only closed on
 * explicit destroy or when disconnect() is called.
 */

import { create } from "zustand";
import { notifyAgentDone, notifyAgentNeedsInput } from "@/lib/notify-agent-done";
import { queryClient } from "@/lib/queryClient";
import { buildUserMessageContent } from "@/types/agent-types";
import { getWsUrl } from "@/lib/ws-url";
import { DEFAULT_MODEL } from "../shared/models";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus, TodoItem } from "@/types/agent";
import type { ContextUsageState } from "@/types/agent";
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
  createSessionDelete,
  createCommandsGet,
  type WsEnvelope,
  type SessionConfig,
  type CommandsListPayload,
} from "@/lib/ws-envelope";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { fetchFeatureAgentState } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";

export type PermissionMode = "acceptEdits" | "plan";

export interface PendingPlanApproval {
  allowedPrompts?: Array<{ tool: string; prompt: string }>;
}

// ---------------------------------------------------------------------------
// Streaming state — tracks in-flight content blocks by index
// ---------------------------------------------------------------------------

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

export function processSdkMessage(
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
            if (toolName === "EnterPlanMode") {
              state.enterPlanModeDetected = true;
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
          if (toolName === "EnterPlanMode") {
            state.enterPlanModeDetected = true;
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
  slashCommands: SlashCommand[];
  slashCommandsLoading: boolean;
  todos: TodoItem[];
  /** Live feature title pushed via WS after auto-naming. */
  featureTitle: string | null;
  /** Pending request-response callbacks keyed by envelope id. */
  pendingWsRequests: Map<string, (payload: unknown) => void>;
  /** Whether older messages exist beyond current window */
  hasMore: boolean;
  /** Lowest message ID in the current window */
  oldestMessageId: number | null;
  /** Feature ID for loading older messages */
  featureId: number | null;
  /** Agent session DB ID for pagination */
  sessionDbId: number | null;
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
    slashCommands: [],
    slashCommandsLoading: false,
    todos: [],
    featureTitle: null,
    pendingWsRequests: new Map(),
    hasMore: false,
    oldestMessageId: null,
    featureId: null,
    sessionDbId: null,
  };
}

// ---------------------------------------------------------------------------
// Helper: mark last plan block with approval status
// ---------------------------------------------------------------------------

function markLastPlanBlock(blocks: AgentBlockData[], status: "approved" | "rejected"): AgentBlockData[] {
  // Find the last ExitPlanMode or show_plan block and set its planApprovalStatus
  const lastIdx = blocks.findLastIndex(
    (b) => b.type === "tool_call" && (b.toolName === "ExitPlanMode" || b.toolName?.endsWith("__show_plan")),
  );
  if (lastIdx === -1) return blocks;
  const updated = [...blocks];
  updated[lastIdx] = { ...updated[lastIdx], planApprovalStatus: status };
  return updated;
}

// ---------------------------------------------------------------------------
// Helper: get WS URL
// ---------------------------------------------------------------------------

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
  sendPrompt: (sessionId: string, text: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  respondToPermission: (sessionId: string, requestId: string, granted: boolean) => void;
  respondToQuestion: (sessionId: string, response: string) => void;
  interrupt: (sessionId: string) => void;
  destroy: (sessionId: string) => void;
  clearSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  setModel: (sessionId: string, modelId: string) => void;
  setPermissionMode: (sessionId: string, mode: PermissionMode) => void;
  approvePlan: (sessionId: string) => void;
  requestPlanChanges: (sessionId: string, feedback: string) => void;

  /** Send a WS envelope and return a promise resolved when the server replies (via ref). */
  sendRequest: (sessionId: string, envelope: WsEnvelope) => Promise<unknown>;

  // Slash commands
  requestSlashCommands: (sessionId: string, cwd: string) => void;

  // Persisted state restoration
  markPersistedLoaded: (sessionId: string) => void;
  setPersistedState: (sessionId: string, options: {
    blocks: AgentBlockData[];
    status: AgentStatus;
    hasMore?: boolean;
    oldestMessageId?: number | null;
    featureId?: number;
    sessionDbId?: number;
  }) => void;
  loadOlderMessages: (sessionId: string) => Promise<void>;
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
    envelope: { domain: string; action: string; ref?: string; payload: unknown },
  ) {
    // Resolve pending request-response callbacks
    if (envelope.ref) {
      const session = get().sessions[sessionId];
      const cb = session?.pendingWsRequests.get(envelope.ref);
      if (cb) {
        session.pendingWsRequests.delete(envelope.ref);
        cb(envelope.payload);
        return;
      }
    }

    // Handle commands domain separately
    if (envelope.domain === "commands") {
      if (envelope.action === "list") {
        const p = envelope.payload as CommandsListPayload;
        const cmds: SlashCommand[] = (p.commands ?? []).map((c) => ({
          name: c.name,
          description: c.description ?? "",
        }));
        set(updateSession(get(), sessionId, {
          slashCommands: cmds,
          slashCommandsLoading: false,
        }));
      }
      return;
    }

    // Handle feature domain events
    if (envelope.domain === "feature" && envelope.action === "updated") {
      const p = envelope.payload as { feature_id?: number; changed?: string[] };
      if (p.feature_id) invalidateFeatureQueries(p.feature_id, p.changed ?? []);
      return;
    }

    if (envelope.domain !== "session") return;

    const session = getSession(sessionId);
    const state = session.streamingState;

    switch (envelope.action) {
      case "initialized": {
        const initPayload = envelope.payload as {
          session_id?: string;
          model?: string;
          input_tokens?: number;
          output_tokens?: number;
          context_window?: number;
        };
        const updates: Partial<SessionEntry> = {
          serverSessionId: initPayload.session_id ?? "",
          status: "idle",
        };
        if (initPayload.model) {
          updates.currentModelId = initPayload.model;
        }
        // Restore context usage from DB if available
        if (initPayload.input_tokens != null || initPayload.output_tokens != null) {
          const inputTokens = initPayload.input_tokens ?? 0;
          const outputTokens = initPayload.output_tokens ?? 0;
          const contextWindow = initPayload.context_window || 200000;
          const totalTokens = inputTokens + outputTokens;
          updates.contextUsage = {
            inputTokens,
            outputTokens,
            totalTokens,
            contextWindow,
            usageRatio: Math.min(1, totalTokens / contextWindow),
            wasCompacted: false,
          };
        }
        set(updateSession(get(), sessionId, updates));
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
          // Extract todos from any TodoWrite tool_call blocks
          // Mutations may lack toolName (e.g. replace/update deltas), so also check
          // the merged block in newBlocks to find TodoWrite blocks affected by mutations.
          const mutatedIds = new Set(allMutations.map((m) => m.block.id));
          const findTodoBlock = (): AgentBlockData | undefined => {
            // Check top-level blocks
            const top = newBlocks.find(
              (b) => b.type === "tool_call" && b.toolName === "TodoWrite" && mutatedIds.has(b.id),
            );
            if (top) return top;
            // Check child blocks (subagent context)
            for (const b of newBlocks) {
              if (!b.childBlocks) continue;
              const child = b.childBlocks.find(
                (c) => c.type === "tool_call" && c.toolName === "TodoWrite" && mutatedIds.has(c.id),
              );
              if (child) return child;
            }
            // Fallback: check mutations directly (for non-streamed append with toolName)
            return allMutations.find(
              (m) => m.block.type === "tool_call" && m.block.toolName === "TodoWrite",
            )?.block;
          };
          const todoBlock = findTodoBlock();
          const patch: Partial<SessionEntry> = { blocks: newBlocks, status: "running" };
          if (hasNewFileChange) patch.hasFileChanges = true;
          if (todoBlock) {
            const argsStr = todoBlock.toolArgs || todoBlock.content;
            if (argsStr) {
              try {
                const parsed = JSON.parse(argsStr);
                if (Array.isArray(parsed?.todos)) {
                  patch.todos = parsed.todos.map((t: Record<string, unknown>) => ({
                    content: String(t.content ?? ""),
                    status: t.status as TodoItem["status"],
                    activeForm: String(t.activeForm ?? ""),
                  }));
                }
              } catch {
                // Incomplete JSON during streaming — ignore
              }
            }
          }
          if (state.enterPlanModeDetected) {
            state.enterPlanModeDetected = false;
            patch.permissionMode = "plan";
          }
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

        // Notify user that the agent needs input
        {
          const sess = get().sessions[sessionId];
          if (sess) {
            let projectId = 0;
            if (sess.featureId) {
              for (const [, data] of queryClient.getQueriesData<{ id: number; project_id: number }[]>({ queryKey: ["features", "list"] })) {
                const feature = data?.find(f => f.id === sess.featureId);
                if (feature) { projectId = feature.project_id; break; }
              }
            }
            notifyAgentNeedsInput({ featureTitle: sess.featureTitle ?? "Session", featureId: sess.featureId ?? 0, projectId, routeType: "session", agentKind: "Session" });
          }
        }

        if (p.tool_name === "ExitPlanMode") {
          // Clear the flag so turn_complete doesn't re-trigger the approval bar
          const session = getSession(sessionId);
          session.streamingState.exitPlanModeDetected = false;
          set(updateSession(get(), sessionId, {
            pendingRequestId: p.request_id,
            pendingPlanApproval: p.tool_input ?? {},
            status: "paused",
          }));
        } else if (p.tool_name === "AskUserQuestion") {
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
        const session = get().sessions[sessionId];
        const existingBlocks = session?.blocks ?? [];
        const previousSessionId = (envelope.payload as Record<string, unknown>)?.previous_session_id as string ?? "";
        set(updateSession(get(), sessionId, {
          blocks: [
            ...existingBlocks,
            { id: `clear-${Date.now()}`, type: "clear_divider" as const, content: previousSessionId },
          ],
          status: "idle",
          streamingState: createStreamingState(),
          pendingPermission: null,
          pendingRequestId: "",
          pendingQuestions: [],
          pendingPlanApproval: null,
          hasFileChanges: false,
          claudeSessionId: "",
        }));
        break;
      }

      case "deleted": {
        // Remove session entry entirely from the store
        const session = get().sessions[sessionId];
        if (session?.ws) {
          session.ws.close();
        }
        const { [sessionId]: _, ...rest } = get().sessions;
        set({ sessions: rest });
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
        if (p.title) {
          set(updateSession(get(), sessionId, { featureTitle: p.title }));
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
        // Notify when a running agent finishes its turn
        const sess = get().sessions[sessionId];
        if (sess?.status === "running") {
          let title = sess.featureTitle;
          let projectId = 0;
          if (sess.featureId) {
            for (const [, data] of queryClient.getQueriesData<{ id: number; title: string; project_id: number }[]>({ queryKey: ["features", "list"] })) {
              const feature = data?.find(f => f.id === sess.featureId);
              if (feature) {
                if (!title) title = feature.title;
                projectId = feature.project_id;
                break;
              }
            }
          }
          notifyAgentDone({ status: "completed", featureTitle: title ?? "Session", featureId: sess.featureId ?? 0, projectId, routeType: "session", agentKind: "Session" });
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
        const session = get().sessions[sessionId];
        if (session?.pendingWsRequests.size) {
          for (const cb of session.pendingWsRequests.values()) cb(null);
          session.pendingWsRequests.clear();
        }
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

    sendRequest(sessionId: string, envelope: WsEnvelope): Promise<unknown> {
      return new Promise((resolve) => {
        const session = get().sessions[sessionId];
        if (session) {
          const timer = setTimeout(() => {
            session.pendingWsRequests.delete(envelope.id);
            resolve(null);
          }, 10_000);
          session.pendingWsRequests.set(envelope.id, (payload) => {
            clearTimeout(timer);
            resolve(payload);
          });
        }
        sendRaw(sessionId, envelope);
      });
    },

    initSession(sessionId: string, config: SessionConfig) {
      if (config.model) {
        set(updateSession(get(), sessionId, { currentModelId: config.model }));
      }
      sendRaw(sessionId, createSessionInit(config));
    },

    sendPrompt(sessionId: string, text: string, images?: Array<{ base64: string; mimeType: string }>) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createPromptSend(session.serverSessionId, text, images));

      const content = buildUserMessageContent(text, images);

      session.streamingState.counter += 1;
      set(updateSession(get(), sessionId, {
        blocks: [
          ...session.blocks,
          {
            id: `ws-user-${session.streamingState.counter}`,
            type: "user_message" as const,
            content,
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
          return `*${question}*\n\n**${answer}**`;
        })
        .join("\n\n\n\n");

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

    deleteSession(sessionId: string) {
      const session = getSession(sessionId);
      sendRaw(sessionId, createSessionDelete(session.serverSessionId));
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
      // Mark the last plan block as approved and add approval user message
      const markedBlocks = markLastPlanBlock(session.blocks, "approved");
      session.streamingState.counter += 1;
      const updatedBlocks = [
        ...markedBlocks,
        {
          id: `ws-user-${session.streamingState.counter}`,
          type: "user_message" as const,
          content: "Plan approved.",
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ];
      if (session.pendingRequestId) {
        // Gate-based approval: respond to the blocked ExitPlanMode permission request
        // Switch to acceptEdits mode so the CLI can execute the plan
        sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
        sendRaw(sessionId, createPermissionRespond(session.serverSessionId, session.pendingRequestId, "allow_once"));
        set(updateSession(get(), sessionId, {
          pendingRequestId: "",
          pendingPlanApproval: null,
          permissionMode: "acceptEdits",
          blocks: updatedBlocks,
          status: "running",
        }));
      } else {
        // Legacy fallback: send as a new prompt
        sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
        sendRaw(sessionId, createPromptSend(session.serverSessionId, "Plan approved. Exit plan mode and proceed with execution."));
        set(updateSession(get(), sessionId, {
          permissionMode: "acceptEdits",
          pendingPlanApproval: null,
          blocks: updatedBlocks,
          status: "running",
        }));
      }
    },

    requestPlanChanges(sessionId: string, feedback: string) {
      const session = getSession(sessionId);
      // Mark the last plan block as rejected and append feedback as user message
      const blocksWithStatus = markLastPlanBlock(session.blocks, "rejected");
      session.streamingState.counter += 1;
      const blocksWithFeedback = [
        ...blocksWithStatus,
        {
          id: `ws-user-${session.streamingState.counter}`,
          type: "user_message" as const,
          content: feedback,
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ];
      if (session.pendingRequestId) {
        // Gate-based rejection: deny the blocked ExitPlanMode permission request with feedback
        sendRaw(sessionId, createPermissionRespond(session.serverSessionId, session.pendingRequestId, "deny", undefined, feedback));
        set(updateSession(get(), sessionId, {
          pendingRequestId: "",
          pendingPlanApproval: null,
          blocks: blocksWithFeedback,
          status: "running",
        }));
      } else {
        // Legacy fallback: send as a new prompt
        sendRaw(sessionId, createPromptSend(session.serverSessionId, feedback));
        set(updateSession(get(), sessionId, {
          pendingPlanApproval: null,
          blocks: blocksWithFeedback,
          status: "running",
        }));
      }
    },

    requestSlashCommands(sessionId: string, cwd: string) {
      const session = getSession(sessionId);
      // Don't re-request if already loaded or loading
      if (session.slashCommands.length > 0 || session.slashCommandsLoading) return;
      set(updateSession(get(), sessionId, { slashCommandsLoading: true }));
      sendRaw(sessionId, createCommandsGet(cwd));
    },

    markPersistedLoaded(sessionId: string) {
      set(updateSession(get(), sessionId, { persistedLoaded: true }));
    },

    setPersistedState(sessionId: string, { blocks, status, hasMore, oldestMessageId, featureId, sessionDbId }: {
      blocks: AgentBlockData[];
      status: AgentStatus;
      hasMore?: boolean;
      oldestMessageId?: number | null;
      featureId?: number;
      sessionDbId?: number;
    }) {
      // Extract todos from restored blocks (last TodoWrite wins)
      const allBlocks = blocks.flatMap((b) => b.childBlocks ? [b, ...b.childBlocks] : [b]);
      let todos: TodoItem[] | undefined;
      for (let i = allBlocks.length - 1; i >= 0; i--) {
        const b = allBlocks[i];
        if (b.type === "tool_call" && b.toolName === "TodoWrite") {
          const argsStr = b.toolArgs || b.content;
          if (argsStr) {
            try {
              const parsed = JSON.parse(argsStr);
              if (Array.isArray(parsed?.todos)) {
                todos = parsed.todos.map((t: Record<string, unknown>) => ({
                  content: String(t.content ?? ""),
                  status: t.status as TodoItem["status"],
                  activeForm: String(t.activeForm ?? ""),
                }));
              }
            } catch {
              // Malformed JSON — skip
            }
          }
          break;
        }
      }
      set(updateSession(get(), sessionId, {
        blocks, status, persistedLoaded: true,
        ...(todos ? { todos } : {}),
        hasMore: hasMore ?? false,
        oldestMessageId: oldestMessageId ?? null,
        featureId: featureId ?? null,
        sessionDbId: sessionDbId ?? null,
      }));
    },

    async loadOlderMessages(sessionId: string) {
      const session = get().sessions[sessionId];
      if (!session || !session.hasMore || session.oldestMessageId == null || !session.featureId || !session.sessionDbId) return;

      const beforeParam = JSON.stringify({ [session.sessionDbId]: session.oldestMessageId });
      const data = await fetchFeatureAgentState(session.featureId, {
        before: beforeParam,
        limit: 100,
      });

      const serverSession = data.sessions.find((s) => s.sessionDbId === session.sessionDbId);
      if (!serverSession) {
        set(updateSession(get(), sessionId, { hasMore: false }));
        return;
      }

      const olderBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);

      const currentSession = get().sessions[sessionId];
      if (!currentSession) return;
      set(updateSession(get(), sessionId, {
        blocks: [...olderBlocks, ...currentSession.blocks],
        hasMore: serverSession.hasMore ?? false,
        oldestMessageId: serverSession.oldestMessageId ?? null,
      }));
    },
  };
});
