import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import {
  parseRuntimeSessionIdPayload,
  parseClearedPayload,
  parseCommandsListPayload,
  parseEndedPayload,
  parseErrorPayload,
  parseFeatureAutoNamingPayload,
  parseFeatureRenamePayload,
  parseFeatureUpdatedPayload,
  parseEffortPayload,
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
  createStreamingState,
  isRecord,
  processSdkMessage,
  applyMutations,
  buildMessagePatch,
} from "./ws-message-processing";
import { normalizeContextWindow } from "@/types/agent";
import type { SessionEntry, WsSessionStore } from "./ws-session-types";
import { updateSession } from "./ws-session-types";
import { transitionTurn, type TurnTerminalReason } from "./ws-turn-lifecycle";

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
  envelope: { action: string; ref?: string; payload: unknown },
): void {
  if (envelope.action === "list") {
    const p = parseCommandsListPayload(envelope.payload);
    if (!p) return;
    const session = ctx.getSession(sessionId);
    if (!envelope.ref || envelope.ref !== session.slashCommandsRequestRef) {
      return;
    }
    const cmds: SlashCommand[] = (p.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description ?? "",
    }));
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        slashCommands: cmds,
        slashCommandsLoading: false,
      }),
    );
  }
}

function handleSessionAction(
  ctx: StoreAccessors,
  sessionId: string,
  envelope: { action: string; payload: unknown },
): void {
  switch (envelope.action) {
    case "initialized":
      handleInitialized(ctx, sessionId, envelope.payload);
      break;
    case "runtime_session_id": {
      const p = parseRuntimeSessionIdPayload(envelope.payload);
      const sessionIdValue = p?.runtime_session_id;
      if (sessionIdValue && sessionIdValue !== ctx.getSession(sessionId).runtimeSessionId) {
        ctx.set(
          updateSession(ctx.get(), sessionId, {
            runtimeSessionId: sessionIdValue,
          }),
        );
      }
      break;
    }
    case "message":
      handleMessage(ctx, sessionId, envelope.payload);
      break;
    case "permission.request":
      handlePermissionRequest(ctx, sessionId, envelope.payload);
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
        ctx.set(
          updateSession(ctx.get(), sessionId, {
            currentProviderId: p.provider,
            runtimeProvider: p.provider,
          }),
        );
      }
      break;
    }
    case "model.set.ok": {
      const p = parseModelPayload(envelope.payload);
      if (p?.model) {
        // A model switch does not alter conversation history, so tokens are
        // preserved. `context_window` is updated only when the backend
        // seeded one authoritatively — otherwise we mark the window as
        // unknown (null) and wait for the next `usage_update`/`result`.
        const existing = ctx.getSession(sessionId).contextUsage;
        const nextContextWindow = p.context_window ?? existing?.contextWindow ?? null;
        const nextUsage = existing
          ? { ...existing, contextWindow: nextContextWindow }
          : {
              inputTokens: 0,
              outputTokens: 0,
              contextWindow: nextContextWindow,
              wasCompacted: false,
            };
        ctx.set(
          updateSession(ctx.get(), sessionId, {
            currentModelId: p.model,
            contextUsage: nextUsage,
          }),
        );
      }
      break;
    }
    case "effort.set.ok": {
      const p = parseEffortPayload(envelope.payload);
      ctx.set(updateSession(ctx.get(), sessionId, { currentThinkingEffort: p?.thinking_effort }));
      break;
    }
    case "error":
      handleError(ctx, sessionId, envelope.payload);
      break;
    case "compact.ok":
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          lifecycle: transitionTurn(ctx.getSession(sessionId).lifecycle, {
            type: "turn_ended",
            reason: "completed",
          }),
        }),
      );
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
    case "feature.autonaming": {
      const p = parseFeatureAutoNamingPayload(envelope.payload);
      if (p) ctx.set(updateSession(ctx.get(), sessionId, { isAutoNaming: p.in_progress }));
      break;
    }
    case "ended":
    case "turn_complete":
      handleTurnComplete(ctx, sessionId, envelope.payload);
      break;
  }
}

function handleInitialized(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const p = parseInitializedPayload(payload);
  if (!p) return;
  const session = ctx.getSession(sessionId);
  const updates: Partial<SessionEntry> = {
    serverSessionId: p.session_id ?? "",
    lifecycle: transitionTurn(session.lifecycle, { type: "initialized" }),
  };
  if (p.provider) {
    updates.currentProviderId = p.provider;
    updates.runtimeProvider = p.provider;
  } else {
    updates.runtimeProvider = ctx.getSession(sessionId).currentProviderId;
  }
  if (p.model) updates.currentModelId = p.model;
  updates.currentThinkingEffort = p.thinking_effort;
  if (p.input_tokens != null || p.output_tokens != null) {
    const contextWindow =
      normalizeContextWindow(p.context_window) ?? session.contextUsage?.contextWindow ?? null;
    updates.contextUsage = {
      inputTokens: p.input_tokens ?? 0,
      outputTokens: p.output_tokens ?? 0,
      contextWindow,
      wasCompacted: false,
    };
  }
  ctx.set(updateSession(ctx.get(), sessionId, updates));
}

function handleMessage(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const p = parseMessageBlocksPayload(payload);
  if (!p) return;
  const state = ctx.getSession(sessionId).streamingState;

  const allMutations: BlockMutation[] = [];
  let enterPlanModeRequested = false;
  let compactBoundaryObserved = false;
  for (const rawBlock of p.blocks) {
    if (!isRecord(rawBlock)) continue;
    const result = processSdkMessage(rawBlock, state);
    allMutations.push(...result.mutations);
    enterPlanModeRequested ||= result.signals.enterPlanModeRequested;
    compactBoundaryObserved ||= result.signals.compactBoundaryObserved;
  }

  if (allMutations.length === 0 && !compactBoundaryObserved) return;

  const currentSession = ctx.getSession(sessionId);
  const patch: Partial<SessionEntry> =
    allMutations.length > 0
      ? buildMessagePatch(
          applyMutations(currentSession.blocks, allMutations, state),
          allMutations,
          { enterPlanModeRequested },
        )
      : {};

  if (compactBoundaryObserved) {
    const existing = currentSession.contextUsage;
    patch.contextUsage = existing
      ? { ...existing, wasCompacted: true }
      : {
          inputTokens: 0,
          outputTokens: 0,
          contextWindow: null,
          wasCompacted: true,
        };
  }

  ctx.set(updateSession(ctx.get(), sessionId, patch));
}

function handlePermissionRequest(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const p = parsePermissionPayload(payload);
  if (!p?.request_id || !p.tool_name) return;
  const session = ctx.get().sessions[sessionId];

  if (p.tool_name === "ExitPlanMode") {
    const current = ctx.get();
    const enrichedArgs = JSON.stringify(p.tool_input ?? {});
    const updatedBlocks = session?.blocks.map((b) =>
      b.type === "tool_call" && b.toolName === "ExitPlanMode" && b.toolUseId === p.request_id
        ? { ...b, toolArgs: enrichedArgs }
        : b,
    );
    ctx.set(
      updateSession(current, sessionId, {
        ...(updatedBlocks ? { blocks: updatedBlocks } : {}),
        pendingRequestId: p.request_id,
        pendingPlanApproval: p.tool_input ?? {},
        lifecycle: transitionTurn(session?.lifecycle ?? { phase: "idle" }, {
          type: "plan_approval_requested",
        }),
      }),
    );
  } else if (p.tool_name === "AskUserQuestion") {
    const toolInput = p.tool_input ?? {};
    const questions: AgentQuestion[] = parseAskUserQuestions(toolInput);
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        pendingRequestId: p.request_id,
        pendingQuestions: questions,
        pendingQuestionToolInput: toolInput,
        lifecycle: transitionTurn(session?.lifecycle ?? { phase: "idle" }, {
          type: "question_requested",
        }),
      }),
    );
  } else {
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        pendingRequestId: p.request_id,
        pendingPermission: {
          toolName: p.tool_name,
          input: p.tool_input ?? {},
          description: p.description ?? "",
          pattern: p.pattern ?? "",
          preview: p.preview,
          options: p.options,
        },
        lifecycle: transitionTurn(session?.lifecycle ?? { phase: "idle" }, {
          type: "permission_requested",
        }),
      }),
    );
  }
}

function handleError(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const p = parseErrorPayload(payload);
  const session = ctx.getSession(sessionId);
  const state = session.streamingState;
  if (p?.message) {
    state.counter += 1;
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        lifecycle: transitionTurn(session.lifecycle, { type: "turn_errored", message: p.message }),
        blocks: [
          ...session.blocks,
          {
            id: `ws-err-${state.counter}`,
            type: "text",
            content: `Error: ${p.message}`,
            isError: true,
          },
        ],
      }),
    );
  } else {
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        lifecycle: transitionTurn(session.lifecycle, { type: "turn_errored" }),
      }),
    );
  }
}

function handleCleared(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const session = ctx.get().sessions[sessionId];
  const existingBlocks = session?.blocks ?? [];
  const previousSessionId = parseClearedPayload(payload)?.previous_session_id ?? "";
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      blocks: [
        ...existingBlocks,
        { id: `clear-${Date.now()}`, type: "clear_divider" as const, content: previousSessionId },
      ],
      lifecycle: transitionTurn(session?.lifecycle ?? { phase: "idle" }, { type: "turn_cleared" }),
      streamingState: createStreamingState(),
      pendingPermission: null,
      pendingRequestId: "",
      pendingQuestions: [],
      pendingPlanApproval: null,
      hasFileChanges: false,
      runtimeSessionId: "",
    }),
  );
}

function handleUsageUpdate(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const u = parseUsagePayload(payload);
  if (!u) return;
  const session = ctx.getSession(sessionId);
  const contextWindow = u.context_window ?? session.contextUsage?.contextWindow ?? null;
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      contextUsage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        contextWindow,
        wasCompacted: session.contextUsage?.wasCompacted ?? false,
      },
    }),
  );
}

function handleTurnComplete(ctx: StoreAccessors, sessionId: string, payload: unknown): void {
  const session = ctx.getSession(sessionId);
  const state = session.streamingState;
  for (const stream of state.streams.values()) {
    if (!stream.parentToolUseId) {
      continue;
    }
    const parent = state.toolUseIdToBlock.get(stream.parentToolUseId);
    if (parent?.childBlocks) parent.taskComplete = true;
    stream.parentToolUseId = null;
  }
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      lifecycle: transitionTurn(session.lifecycle, {
        type: "turn_ended",
        reason: mapTerminalReason(parseEndedPayload(payload)?.reason),
      }),
    }),
  );
}

function mapTerminalReason(reason: string | undefined): TurnTerminalReason {
  switch (reason) {
    case "provider_complete":
    case "turn_complete":
      return "completed";
    case "stream_closed":
      return "streamClosed";
    case "turn_cleared":
      return "cleared";
    case "permission_denied":
      return "denied";
    default:
      return "completed";
  }
}
