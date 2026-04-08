import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { CommandsListPayload } from "@/lib/ws-envelope";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
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

// Types for the store accessors we need

export interface StoreAccessors {
  get: () => WsSessionStore;
  set: (partial: Partial<WsSessionStore>) => void;
  getSession: (sessionId: string) => SessionEntry;
}

// Worktree events

function handleWorktreeEvent(
  ctx: StoreAccessors,
  sessionId: string,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case "worktree.creating":
      ctx.set(updateSession(ctx.get(), sessionId, {
        worktreeStatus: "creating",
        worktreeBranch: (payload.branch as string) ?? null,
        worktreePath: (payload.path as string) ?? null,
        worktreeError: null,
      }));
      break;
    case "worktree.created":
      ctx.set(updateSession(ctx.get(), sessionId, {
        worktreeStatus: "created",
        worktreeBranch: (payload.branch as string) ?? null,
        worktreePath: (payload.path as string) ?? null,
      }));
      break;
    case "worktree.setup_running":
      ctx.set(updateSession(ctx.get(), sessionId, { worktreeStatus: "setup_running" }));
      break;
    case "worktree.setup_output": {
      const session = ctx.getSession(sessionId);
      ctx.set(updateSession(ctx.get(), sessionId, {
        worktreeSetupOutput: [...session.worktreeSetupOutput, payload.line as string],
      }));
      break;
    }
    case "worktree.ready":
      ctx.set(updateSession(ctx.get(), sessionId, { worktreeStatus: "ready" }));
      break;
    case "worktree.setup_error":
      ctx.set(updateSession(ctx.get(), sessionId, {
        worktreeStatus: "setup_error",
        worktreeError: (payload.error as string) ?? (payload.message as string) ?? null,
      }));
      break;
  }
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
    const p = envelope.payload as { feature_id?: number; changed?: string[] };
    if (p.feature_id) invalidateFeatureQueries(p.feature_id, p.changed ?? []);
    return;
  }

  if (envelope.domain === "workflow") {
    handleWorktreeEvent(ctx, sessionId, envelope.action, envelope.payload as Record<string, unknown>);
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
    const p = envelope.payload as CommandsListPayload;
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
      const p = envelope.payload as { claude_session_id?: string };
      if (p.claude_session_id && p.claude_session_id !== ctx.getSession(sessionId).claudeSessionId) {
        ctx.set(updateSession(ctx.get(), sessionId, { claudeSessionId: p.claude_session_id }));
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
      const p = envelope.payload as { mode?: string };
      if (p.mode === "acceptEdits" || p.mode === "plan") {
        ctx.set(updateSession(ctx.get(), sessionId, { permissionMode: p.mode }));
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
      if (del?.ws) del.ws.close();
      const { [sessionId]: _, ...rest } = ctx.get().sessions;
      ctx.set({ sessions: rest });
      break;
    }
    case "usage_update":
      handleUsageUpdate(ctx, sessionId, envelope.payload);
      break;
    case "feature.renamed": {
      const p = envelope.payload as { feature_id?: number; title?: string };
      if (p.title) ctx.set(updateSession(ctx.get(), sessionId, { featureTitle: p.title }));
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
  const p = payload as {
    session_id?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    context_window?: number;
  };
  const updates: Partial<SessionEntry> = {
    serverSessionId: p.session_id ?? "",
    status: "idle",
  };
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
  const p = payload as { blocks?: unknown[] };
  if (!p.blocks || !Array.isArray(p.blocks)) return;

  const allMutations: BlockMutation[] = [];
  for (const rawBlock of p.blocks) {
    if (!rawBlock || typeof rawBlock !== "object") continue;
    allMutations.push(...processSdkMessage(rawBlock as Record<string, unknown>, state));
  }

  if (allMutations.length > 0) {
    const currentSession = ctx.getSession(sessionId);
    const newBlocks = applyMutations(currentSession.blocks, allMutations, state);
    const patch = buildMessagePatch(newBlocks, allMutations, state);
    ctx.set(updateSession(ctx.get(), sessionId, patch));
  } else {
    ctx.set(updateSession(ctx.get(), sessionId, { status: "running" }));
  }
}

function handlePermissionRequest(
  ctx: StoreAccessors,
  sessionId: string,
  payload: unknown,
  state: StreamingState,
): void {
  const p = payload as {
    request_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
    description?: string;
    pattern?: string;
  };

  if (p.tool_name === "ExitPlanMode") {
    state.exitPlanModeDetected = false;
    ctx.set(updateSession(ctx.get(), sessionId, {
      pendingRequestId: p.request_id,
      pendingPlanApproval: p.tool_input ?? {},
      status: "paused",
    }));
  } else if (p.tool_name === "AskUserQuestion") {
    const toolInput = (p.tool_input ?? {}) as Record<string, unknown>;
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
  const p = payload as { message?: string };
  if (p.message) {
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
  const previousSessionId = (payload as Record<string, unknown>)?.previous_session_id as string ?? "";
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
  const u = payload as { input_tokens: number; output_tokens: number; context_window: number };
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
  if (state.parentToolUseId) {
    const parent = state.toolUseIdToBlock.get(state.parentToolUseId);
    if (parent?.childBlocks) parent.taskComplete = true;
    state.parentToolUseId = null;
  }
  if (state.exitPlanModeDetected) {
    state.exitPlanModeDetected = false;
    ctx.set(updateSession(ctx.get(), sessionId, {
      pendingPlanApproval: {},
      status: "paused",
    }));
  } else {
    ctx.set(updateSession(ctx.get(), sessionId, { status: "idle" }));
  }
}
