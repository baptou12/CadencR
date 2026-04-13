import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import {
  parseClaudeSessionIdPayload,
  parseClearedPayload,
  parseCommandsListPayload,
  parseErrorPayload,
  parseFeatureRenamePayload,
  parseFeatureUpdatedPayload,
  parseInitializedPayload,
  parseMessageBlocksPayload,
  parseModePayload,
  parseModelPayload,
  parsePermissionPayload,
  parseProviderPayload,
  parseUsagePayload,
} from "./ws-envelope-payload";
import { handleWorktreeEvent } from "./ws-worktree-handler";
import {
  type BlockMutation,
  type StreamingState,
  createStreamingState,
  processSdkMessage,
  applyMutations,
  buildMessagePatch,
} from "./ws-message-processing";
import type { SessionEntry, WsSessionStore } from "./ws-session-types";
import { updateSession } from "./ws-session-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

// Types for the store accessors we need

export interface StoreAccessors {
  get: () => WsSessionStore;
  set: (partial: Partial<WsSessionStore>) => void;
  getSession: (sessionId: string) => SessionEntry;
}

// Main envelope handler

export function handleEnvelope(
  ctx: StoreAccessors,
  sessionId: string,
  envelope: { domain: string; action: string; ref?: string; payload: unknown },
): void {
  // Resolve pending request-response callbacks
  if (envelope.ref) {
    const session = ctx.get().sessions[sessionId];
    const cb = session?.pendingWsRequests.get(envelope.ref);
    if (cb) {
      session.pendingWsRequests.delete(envelope.ref);
      cb(envelope.payload);
      return;
    }
  }

  if (envelope.domain === "commands") {
    handleCommandsDomain(ctx, sessionId, envelope);
    return;
  }

  if (envelope.domain === "feature" && envelope.action === "updated") {
    const p = parseFeatureUpdatedPayload(envelope.payload);
    if (p?.feature_id) invalidateFeatureQueries(p.feature_id, p.changed);
    return;
  }

  if (envelope.domain === "workflow") {
    handleWorktreeEvent(ctx, sessionId, envelope.action, envelope.payload);
    return;
  }

  if (envelope.domain !== "session") return;

  handleSessionAction(ctx, sessionId, envelope);
}

// Commands domain

function handleCommandsDomain(
  ctx: StoreAccessors,
  sessionId: string,
  envelope: { action: string; payload: unknown },
): void {
  if (envelope.action === "list") {
    const p = parseCommandsListPayload(envelope.payload);
    if (!p) return;
    const cmds: SlashCommand[] = (p.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description ?? "",
    }));
    ctx.set(updateSession(ctx.get(), sessionId, {
      slashCommands: cmds,
      slashCommandsLoading: false,
    }));
  }
}

function handleSessionAction(
  ctx: StoreAccessors,
  sessionId: string,
  envelope: { action: string; payload: unknown },
): void {
  const session = ctx.getSession(sessionId);
  const state = session.streamingState;

  switch (envelope.action) {
    case "initialized":
      handleInitialized(ctx, sessionId, envelope.payload);
      break;
    case "claude_session_id": {
      const p = parseClaudeSessionIdPayload(envelope.payload);
      const sessionIdValue = p?.claude_session_id;
      if (sessionIdValue && sessionIdValue !== ctx.getSession(sessionId).claudeSessionId) {
        ctx.set(updateSession(ctx.get(), sessionId, {
          claudeSessionId: sessionIdValue,
          runtimeSessionId: sessionIdValue,
        }));
      }
      break;
    }
    case "message":
      handleMessage(ctx, sessionId, envelope.payload, state);
      break;
    case "permission.request":
      handlePermissionRequest(ctx, sessionId, envelope.payload, state);
      break;
    case "mode.changed": {
      const p = parseModePayload(envelope.payload);
      if (p?.mode === "acceptEdits" || p?.mode === "plan") {
        ctx.set(updateSession(ctx.get(), sessionId, { permissionMode: p.mode }));
      }
      break;
    }
    case "provider.set.ok": {
      const p = parseProviderPayload(envelope.payload);
      if (p?.provider) {
        ctx.set(updateSession(ctx.get(), sessionId, {
          currentProviderId: p.provider,
          runtimeProvider: p.provider,
        }));
      }
      break;
    }
    case "model.set.ok": {
      const p = parseModelPayload(envelope.payload);
      if (p?.model) {
        ctx.set(updateSession(ctx.get(), sessionId, { currentModelId: p.model }));
      }
      break;
    }
    case "error":
      handleError(ctx, sessionId, envelope.payload, state);
      break;
    case "cleared":
      handleCleared(ctx, sessionId, envelope.payload);
      break;
    case "deleted": {
      const del = ctx.get().sessions[sessionId];
      if (del?.conn) del.conn.close();
      const { [sessionId]: _, ...rest } = ctx.get().sessions;
      ctx.set({ sessions: rest });
      break;
    }
    case "usage_update":
      handleUsageUpdate(ctx, sessionId, envelope.payload);
      break;
    case "feature.renamed": {
      const p = parseFeatureRenamePayload(envelope.payload);
      if (p?.title) ctx.set(updateSession(ctx.get(), sessionId, { featureTitle: p.title }));
      break;
    }
    case "ended":
    case "turn_complete":
      handleTurnComplete(ctx, sessionId, state);
      break;
  }
}

function handleInitialized(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
): void {
  const p = parseInitializedPayload(payload);
  if (!p) return;
  const updates: Partial<SessionEntry> = {
    serverSessionId: p.session_id ?? "",
    status: ctx.getSession(sessionId).queuedPrompts.length > 0 ? "running" : "idle",
  };
  if (p.provider) {
    updates.currentProviderId = p.provider;
    updates.runtimeProvider = p.provider;
  } else {
    updates.runtimeProvider = ctx.getSession(sessionId).currentProviderId;
  }
  if (p.model) updates.currentModelId = p.model;
  if (p.input_tokens != null || p.output_tokens != null) {
    const inputTokens = p.input_tokens ?? 0;
    const outputTokens = p.output_tokens ?? 0;
    const contextWindow = p.context_window || 200000;
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
  ctx.set(updateSession(ctx.get(), sessionId, updates));
}

function handleMessage(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
  state: StreamingState,
): void {
  const p = parseMessageBlocksPayload(payload);
  if (!p) return;

  const allMutations: BlockMutation[] = [];
  for (const rawBlock of p.blocks) {
    if (!isRecord(rawBlock)) continue;
    allMutations.push(...processSdkMessage(rawBlock, state));
  }

  if (allMutations.length > 0) {
    const currentSession = ctx.getSession(sessionId);
    const newBlocks = applyMutations(currentSession.blocks, allMutations, state);
    const patch = buildMessagePatch(newBlocks, allMutations, state);
    ctx.set(updateSession(ctx.get(), sessionId, patch));
  }
}

function handlePermissionRequest(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
  state: StreamingState,
): void {
  const p = parsePermissionPayload(payload);
  if (!p?.request_id || !p.tool_name) return;

  if (p.tool_name === "ExitPlanMode") {
    state.exitPlanModeDetected = false;
    const current = ctx.get();
    const session = current.sessions[sessionId];
    const enrichedArgs = JSON.stringify(p.tool_input ?? {});
    const updatedBlocks = session?.blocks.map((b) =>
      b.type === "tool_call" && b.toolName === "ExitPlanMode" && b.toolUseId === p.request_id
        ? { ...b, toolArgs: enrichedArgs }
        : b,
    );
    ctx.set(updateSession(current, sessionId, {
      ...(updatedBlocks ? { blocks: updatedBlocks } : {}),
      pendingRequestId: p.request_id,
      pendingPlanApproval: p.tool_input ?? {},
      status: "paused",
    }));
  } else if (p.tool_name === "AskUserQuestion") {
    const toolInput = p.tool_input ?? {};
    const questions: AgentQuestion[] = parseAskUserQuestions(toolInput);
    ctx.set(updateSession(ctx.get(), sessionId, {
      pendingRequestId: p.request_id,
      pendingQuestions: questions,
      pendingQuestionToolInput: toolInput,
      status: "paused",
    }));
  } else {
    ctx.set(updateSession(ctx.get(), sessionId, {
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
}

function handleError(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
  state: StreamingState,
): void {
  const p = parseErrorPayload(payload);
  if (p?.message) {
    state.counter += 1;
    const currentSession = ctx.getSession(sessionId);
    ctx.set(updateSession(ctx.get(), sessionId, {
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
    ctx.set(updateSession(ctx.get(), sessionId, { status: "error" }));
  }
}

function handleCleared(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
): void {
  const session = ctx.get().sessions[sessionId];
  const existingBlocks = session?.blocks ?? [];
  const previousSessionId = parseClearedPayload(payload)?.previous_session_id ?? "";
  ctx.set(updateSession(ctx.get(), sessionId, {
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
}

function handleUsageUpdate(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
): void {
  const u = parseUsagePayload(payload);
  if (!u) return;
  const totalTokens = u.input_tokens + u.output_tokens;
  const contextWindow = u.context_window || 200000;
  ctx.set(updateSession(ctx.get(), sessionId, {
    contextUsage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      totalTokens,
      contextWindow,
      usageRatio: Math.min(1, totalTokens / contextWindow),
      wasCompacted: false,
    },
  }));
}

function handleTurnComplete(
  ctx: StoreAccessors,
  sessionId: string,
  state: StreamingState,
): void {
  for (const stream of state.streams.values()) {
    if (!stream.parentToolUseId) {
      continue;
    }
    const parent = state.toolUseIdToBlock.get(stream.parentToolUseId);
    if (parent?.childBlocks) parent.taskComplete = true;
    stream.parentToolUseId = null;
  }
  if (state.exitPlanModeDetected) {
    state.exitPlanModeDetected = false;
    ctx.set(updateSession(ctx.get(), sessionId, {
      pendingPlanApproval: {},
      status: "paused",
    }));
  } else {
    ctx.set(updateSession(ctx.get(), sessionId, {
      status: "idle",
    }));
  }
}
