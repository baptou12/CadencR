import type { SlashCommand } from "@/hooks/useSlashCommand";
import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { queryClient } from "@/lib/queryClient";
import { getWorkspaceSettingsQueryKey } from "@/api/settings";
import {
  parseRuntimeSessionIdPayload,
  parseCommandsListPayload,
  parseFeatureAutoNamingPayload,
  parseFeatureRenamePayload,
  parseFeatureUpdatedPayload,
  parseEffortPayload,
  parseLifecyclePayload,
  parseModePayload,
  parseModelPayload,
  parseProviderPayload,
} from "./ws-envelope-payload";
import { handleWorktreeEvent } from "./ws-worktree-handler";
import { useGitStatusStore } from "./useGitStatusStore";
import { isRecord } from "./ws-message-processing";
import { parseCodexPermissionMode } from "@/types/codex-permission-mode";
import { updateSession } from "./ws-session-types";
import { transitionTurn } from "./ws-turn-lifecycle";
import { findProviderMode } from "@/lib/provider-modes";
import { OPENCODE_AGENT_MODE_PREFIX, parsePermissionMode } from "@/types/permission-mode";
import type { StoreAccessors } from "./ws-envelope-types";
import {
  handleCleared,
  handleGateClosed,
  handleInitialized,
  handleMessage,
  handlePermissionRequest,
  handlePromptReceived,
} from "./ws-envelope-session-handlers";
import { handleError } from "./ws-envelope-error-handler";
import {
  handleStreamStatus,
  handleTurnComplete,
  handleUsageUpdate,
} from "./ws-envelope-turn-handlers";

export type { StoreAccessors } from "./ws-envelope-types";

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
    // `worktree.created` / `worktree.ready` are the moments when the
    // backend has just written `worktree_path` to the DB and the
    // git-status watcher needs to be re-bound to the new path. Bump the
    // per-feature epoch so any mounted `useGitStatusSubscription` re-issues
    // its subscribe envelope (which makes the backend re-resolve the path).
    if (envelope.action === "worktree.created" || envelope.action === "worktree.ready") {
      const featureId =
        isRecord(envelope.payload) && typeof envelope.payload.feature_id === "number"
          ? envelope.payload.feature_id
          : null;
      if (featureId != null) {
        useGitStatusStore.getState().bumpWatcherEpoch(featureId);
      }
    }
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
      kind: c.kind ?? "command",
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
    case "codex_permission_mode.changed": {
      const p = parseModePayload(envelope.payload);
      if (p?.mode) {
        ctx.set(
          updateSession(ctx.get(), sessionId, {
            codexPermissionMode: parseCodexPermissionMode(p.mode),
          }),
        );
      }
      break;
    }
    case "mode.changed": {
      const p = parseModePayload(envelope.payload);
      // Accept any mode the active provider's catalog defines. Unknown values
      // are dropped silently — the backend rejects them via MODE_NOT_SUPPORTED
      // before we ever see this event, so reaching this branch with an
      // unrecognized mode would mean the FE catalog is stale.
      const session = p?.mode ? ctx.getSession(sessionId) : null;
      const parsedMode = p?.mode ? parsePermissionMode(p.mode) : null;
      if (parsedMode && session) {
        const providerId = session.currentProviderId || session.runtimeProvider;
        if (
          findProviderMode(providerId, parsedMode) ||
          parsedMode.startsWith(OPENCODE_AGENT_MODE_PREFIX)
        ) {
          ctx.set(
            updateSession(ctx.get(), sessionId, {
              permissionMode: parsedMode,
            }),
          );
        }
      }
      break;
    }
    case "provider.set.ok": {
      const p = parseProviderPayload(envelope.payload);
      if (p?.provider) {
        // Provider switch only updates provider state; the backend follows up
        // with a `mode.changed` envelope carrying the new provider's default
        // permission mode. We let that envelope drive the chip state via the
        // shared path above instead of writing it optimistically here (would
        // create dual sources of truth — see no-optimistic-updates.md).
        ctx.set(
          updateSession(ctx.get(), sessionId, {
            currentProviderId: p.provider,
            runtimeProvider: p.provider,
            supportsPromptReceipts: p.supports_prompt_receipts ?? false,
            ...(p.codex_permission_mode
              ? {
                  codexPermissionMode: parseCodexPermissionMode(p.codex_permission_mode),
                }
              : {}),
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
      const previous = ctx.get().sessions[sessionId]?.currentThinkingEffort;
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          currentThinkingEffort: p?.thinking_effort,
        }),
      );
      // The backend writes the per-model workspace default
      // (`thinking_effort_model_<provider>_<model>`) only when the effort
      // actually changed, so we mirror that condition to avoid a redundant
      // workspace-settings refetch on no-op confirmations.
      if (p?.thinking_effort !== previous) {
        void queryClient.invalidateQueries({
          queryKey: getWorkspaceSettingsQueryKey(),
        });
      }
      break;
    }
    case "error":
      handleError(ctx, sessionId, envelope.payload);
      break;
    case "compact.started":
      if (ctx.getSession(sessionId).compactRequestPending) {
        ctx.set(
          updateSession(ctx.get(), sessionId, {
            compactRequestPending: false,
            pendingManualCompact: true,
          }),
        );
      }
      break;
    case "compact.ok":
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          lifecycle: transitionTurn(ctx.getSession(sessionId).lifecycle, {
            type: "turn_ended",
            reason: "completed",
          }),
          compactRequestPending: false,
          pendingManualCompact: false,
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
    case "stream_status":
      handleStreamStatus(ctx, sessionId, envelope.payload);
      break;
    case "prompt_received":
      handlePromptReceived(ctx, sessionId, envelope.payload);
      break;
    case "lifecycle": {
      // OS suspend / resume — backend-confirmed transitions. Per
      // `no-optimistic-updates.md`, the FE flips lifecycle only here,
      // never on the raw Electron power event.
      const p = parseLifecyclePayload(envelope.payload);
      if (!p) break;
      const session = ctx.getSession(sessionId);
      const event = p.kind === "suspend_requested" ? "suspended" : "resumed";
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          lifecycle: transitionTurn(session.lifecycle, { type: event }),
        }),
      );
      break;
    }
    case "gate.closed":
      handleGateClosed(ctx, sessionId, envelope.payload);
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
