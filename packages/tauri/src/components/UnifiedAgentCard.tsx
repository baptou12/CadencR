import { memo, useLayoutEffect, useMemo, type ReactElement } from "react";
import { toast } from "sonner";
import type { UnifiedAgentEntry } from "@/api/generated";
import { AgentSession } from "@/components/agent-session";
import { EmbeddedFeatureHeader } from "@/components/EmbeddedFeatureHeader";
import { useUnifiedAgentPinControls } from "@/components/useUnifiedAgentPinControls";
import { WebSocketSessionFeatureBlock } from "@/components/WebSocketSessionFeatureBlock";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import { cn } from "@/lib/utils";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { createSessionEntry, type SessionEntry } from "@/stores/ws-session-types";
import type { TurnLifecycle } from "@/stores/ws-turn-lifecycle";
import { normalizeContextWindow } from "@/types/agent";
import type { ContextUsageState, LiveAgentStatus } from "@/types/agent";
import type { AgentType } from "@/types/agent-types";
import type { PermissionMode } from "@/types/permission-mode";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";

type WsSessionState = ReturnType<(typeof useWsSessionStore)["getState"]>;
type PersistedSnapshot = Parameters<WsSessionState["setPersistedState"]>[1];

interface UnifiedAgentCardProps {
  entry: UnifiedAgentEntry;
  index: number;
  isActive: boolean;
  onActivate: (index: number) => void;
}

export const UnifiedAgentCard = memo(function UnifiedAgentCard({
  entry,
  index,
  isActive,
  onActivate,
}: UnifiedAgentCardProps): ReactElement {
  useHydrateUnifiedWsSession(entry);
  const pinControls = useUnifiedAgentPinControls(entry);
  const activate = (): void => onActivate(index);
  const baseClass = cn(
    "group/card relative flex h-full min-h-[420px] flex-col overflow-hidden rounded-[10px] border bg-card shadow-sm outline-none transition-[border-color,box-shadow]",
    "focus-visible:ring-2 focus-visible:ring-ring",
    isActive ? "border-primary/45" : "border-border hover:border-primary/30",
  );

  if (entry.feature.type === "ws-session") {
    return (
      <section
        tabIndex={0}
        data-unified-agent-index={index}
        onFocusCapture={activate}
        onPointerDownCapture={activate}
        className={baseClass}
      >
        <WebSocketSessionFeatureBlock
          sessionId={wsSessionIdFromFeature(entry.feature.id)}
          cwd={entry.project.path}
          featureId={entry.feature.id}
          projectId={entry.project.id}
          layoutFeatureId={-entry.session.sessionDbId}
          embedded
          hotkeysEnabled={isActive}
          onActivate={activate}
          projectName={entry.project.name}
          featureTitle={entry.feature.title}
          lastActivityAt={entry.last_activity_at}
          isPinned={entry.is_pinned}
          isPinPending={pinControls.isPending}
          onTogglePin={pinControls.toggle}
        />
      </section>
    );
  }

  return (
    <section
      tabIndex={0}
      data-unified-agent-index={index}
      onFocusCapture={activate}
      onPointerDownCapture={activate}
      className={baseClass}
    >
      <EmbeddedFeatureHeader
        featureId={entry.feature.id}
        projectId={entry.project.id}
        projectName={entry.project.name}
        title={entry.feature.title}
        lastActivityAt={entry.last_activity_at}
        isPinned={entry.is_pinned}
        isPinPending={pinControls.isPending}
        onTogglePin={pinControls.toggle}
      />
      <div className="min-h-0 flex-1">
        <UnifiedReadOnlyAgent entry={entry} index={index} hotkeysEnabled={isActive} />
      </div>
    </section>
  );
});

function useHydrateUnifiedWsSession(entry: UnifiedAgentEntry): void {
  const sessionId =
    entry.feature.type === "ws-session" ? wsSessionIdFromFeature(entry.feature.id) : null;
  useLayoutEffect(() => {
    if (!sessionId) return;
    const current = useWsSessionStore.getState().sessions[sessionId];
    ensureWsSessionEntry(sessionId);
    if (shouldRestoreUnifiedBlocks(current)) {
      useWsSessionStore.getState().setPersistedState(sessionId, buildPersistedSnapshot(entry));
    }
    patchHydratedSession(sessionId, entry);
  }, [entry, sessionId]);
}

function shouldRestoreUnifiedBlocks(session: SessionEntry | undefined): boolean {
  if (!session) return true;
  if (session.persistedLoaded || session.blocks.length > 0) return false;
  return !session.conn && !session.isConnected && !session.serverSessionId;
}

function ensureWsSessionEntry(sessionId: string): void {
  if (useWsSessionStore.getState().sessions[sessionId]) return;
  useWsSessionStore.setState((state) => ({
    sessions: {
      ...state.sessions,
      [sessionId]: createSessionEntry(),
    },
  }));
}

function patchHydratedSession(sessionId: string, entry: UnifiedAgentEntry): void {
  useWsSessionStore.setState((state) => {
    const session = state.sessions[sessionId];
    if (!session) return state;
    const patch = buildUnifiedSessionPatch(entry, session);
    if (!hasSessionPatchChanges(session, patch)) return state;
    return {
      sessions: {
        ...state.sessions,
        [sessionId]: { ...session, ...patch },
      },
    };
  });
}

function buildPersistedSnapshot(entry: UnifiedAgentEntry): PersistedSnapshot {
  const pendingPermission = asPendingPermission(entry.session.pendingPermission);
  const pendingQuestions = asQuestions(entry.session.pendingQuestions) ?? [];
  const pendingPlanApproval = asPlanApproval(entry.session.pendingPlanApproval);
  return {
    blocks: serverBlocksToAgentBlocks(entry.session.blocks),
    lifecycle: unifiedStatusToLifecycle(entry, {
      pendingPermission,
      pendingQuestions,
      pendingPlanApproval,
    }),
    hasMore: entry.session.hasMore,
    oldestMessageId: entry.session.oldestMessageId,
    featureId: entry.feature.id,
    sessionDbId: entry.session.sessionDbId,
    currentProviderId: entry.session.runtimeProvider ?? undefined,
    currentModelId: entry.session.model ?? undefined,
    runtimeProvider: entry.session.runtimeProvider,
    runtimeSessionId: entry.session.runtimeSessionId,
    pendingPlanApproval,
    contextUsage: buildContextUsage(entry),
    hasFileChanges: entry.session.hasFileChanges,
  };
}

function buildUnifiedSessionPatch(
  entry: UnifiedAgentEntry,
  session: SessionEntry,
): Partial<SessionEntry> {
  const pendingPermission = asPendingPermission(entry.session.pendingPermission);
  const pendingQuestions = asQuestions(entry.session.pendingQuestions) ?? [];
  const pendingPlanApproval = asPlanApproval(entry.session.pendingPlanApproval);
  const permissionMode = asPermissionMode(entry.session.permissionMode);
  const lifecycle = unifiedStatusToLifecycle(entry, {
    pendingPermission,
    pendingQuestions,
    pendingPlanApproval,
  });
  const patch: Partial<SessionEntry> = {
    pendingPermission,
    pendingQuestions,
    pendingPlanApproval,
    contextUsage: buildContextUsage(entry),
    hasFileChanges: entry.session.hasFileChanges,
    hasMore: entry.session.hasMore,
    oldestMessageId: entry.session.oldestMessageId,
    featureId: entry.feature.id,
    sessionDbId: entry.session.sessionDbId,
    ...(permissionMode ? { permissionMode } : {}),
    ...(entry.session.runtimeProvider ? { currentProviderId: entry.session.runtimeProvider } : {}),
    ...(entry.session.model ? { currentModelId: entry.session.model } : {}),
    ...(entry.session.runtimeProvider ? { runtimeProvider: entry.session.runtimeProvider } : {}),
    ...(entry.session.runtimeSessionId ? { runtimeSessionId: entry.session.runtimeSessionId } : {}),
    ...pendingRequestIdPatch(session, pendingPermission, pendingQuestions, pendingPlanApproval),
  };
  if (shouldPatchLifecycle(session, lifecycle)) {
    patch.lifecycle = lifecycle;
  }
  return patch;
}

function pendingRequestIdPatch(
  session: SessionEntry,
  pendingPermission: PendingPermission | null,
  pendingQuestions: AgentQuestion[],
  pendingPlanApproval: ReturnType<typeof asPlanApproval>,
): Partial<SessionEntry> {
  if (pendingPermission?.requestId) return { pendingRequestId: pendingPermission.requestId };
  if (pendingPlanApproval && !session.pendingRequestId) {
    const suffix = session.sessionDbId ?? session.featureId ?? "unknown";
    return { pendingRequestId: `plan_restore_unified_${suffix}` };
  }
  if (!pendingPermission && pendingQuestions.length === 0 && !pendingPlanApproval) {
    return { pendingRequestId: "" };
  }
  return {};
}

function shouldPatchLifecycle(session: SessionEntry, nextLifecycle: TurnLifecycle): boolean {
  if (nextLifecycle.phase === "active" || nextLifecycle.phase === "paused") return true;
  return session.lifecycle.phase !== "active";
}

function unifiedStatusToLifecycle(
  entry: UnifiedAgentEntry,
  pending: {
    pendingPermission: PendingPermission | null;
    pendingQuestions: AgentQuestion[];
    pendingPlanApproval: ReturnType<typeof asPlanApproval>;
  },
): TurnLifecycle {
  if (pending.pendingPlanApproval) return { phase: "paused", reason: "planApproval" };
  if (pending.pendingQuestions.length > 0 || entry.session.pendingPrdApproval) {
    return { phase: "paused", reason: "question" };
  }
  if (pending.pendingPermission) return { phase: "paused", reason: "permission" };
  if (entry.session.status === "running") return { phase: "active" };
  if (entry.session.status === "completed") return { phase: "terminal", reason: "completed" };
  if (entry.session.status === "error") return { phase: "error" };
  if (entry.session.status === "paused" || entry.session.status === "waiting") {
    return { phase: "paused", reason: "user" };
  }
  return { phase: "idle" };
}

function hasSessionPatchChanges(session: SessionEntry, patch: Partial<SessionEntry>): boolean {
  for (const key of Object.keys(patch)) {
    const typedKey = key as keyof SessionEntry;
    if (!sessionFieldEquals(session[typedKey], patch[typedKey])) return true;
  }
  return false;
}

function sessionFieldEquals(current: unknown, next: unknown): boolean {
  if (Object.is(current, next)) return true;
  return safeStringify(current) === safeStringify(next);
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function UnifiedReadOnlyAgent({
  entry,
  index,
  hotkeysEnabled,
}: {
  entry: UnifiedAgentEntry;
  index: number;
  hotkeysEnabled: boolean;
}): ReactElement {
  const liveStatus = useSessionStatusStore(
    (s) => s.bySession[entry.session.sessionDbId]?.status ?? null,
  );
  const blocks = useMemo(() => serverBlocksToAgentBlocks(entry.session.blocks), [entry.session]);
  const contextUsage = useMemo<ContextUsageState>(() => buildContextUsage(entry), [entry]);
  const status = liveStatus ?? persistedStatusToLive(entry);
  const activeFeatureId = hotkeysEnabled ? entry.feature.id : undefined;
  const activeProjectId = hotkeysEnabled ? entry.project.id : undefined;

  return (
    <AgentSession
      agentType={entry.session.agentType as AgentType}
      label={labelForEntry(entry)}
      navAgentIndex={index}
      featureId={activeFeatureId}
      projectId={activeProjectId}
      sessionId={entry.session.sessionDbId}
      blocks={blocks}
      status={status}
      onSend={() => {
        toast.info("Open this feature to interact with workflow agents.");
      }}
      onStop={() => {
        toast.info("Open this feature to stop this workflow agent.");
      }}
      pendingPermission={asPendingPermission(entry.session.pendingPermission)}
      pendingQuestions={asQuestions(entry.session.pendingQuestions)}
      pendingPlanApproval={asPlanApproval(entry.session.pendingPlanApproval)}
      contextUsage={contextUsage}
      currentProviderId={entry.session.runtimeProvider ?? undefined}
      currentModelId={entry.session.model ?? undefined}
      runtimeProvider={entry.session.runtimeProvider ?? undefined}
      runtimeSessionId={entry.session.runtimeSessionId ?? undefined}
      hasFileChanges={entry.session.hasFileChanges}
      hasMore={entry.session.hasMore}
      initialDraft={entry.session.draftPrompt}
      disableShortcuts={!hotkeysEnabled}
      disabled
      agentTabActive={hotkeysEnabled}
      className={cn("h-full", status !== "idle" && "ring-1 ring-primary/20")}
    />
  );
}

function persistedStatusToLive(entry: UnifiedAgentEntry): LiveAgentStatus {
  if (
    entry.session.pendingQuestions ||
    entry.session.pendingPermission ||
    entry.session.pendingPlanApproval ||
    entry.session.pendingPrdApproval
  ) {
    return "question";
  }
  return entry.session.status === "running" ? "agent" : "idle";
}

function labelForEntry(entry: UnifiedAgentEntry): string {
  const phaseTitle = entry.session.phaseTitle;
  return phaseTitle ? `${entry.session.agentType} · ${phaseTitle}` : entry.session.agentType;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPendingPermission(value: unknown): PendingPermission | null {
  return isObject(value) ? (value as unknown as PendingPermission) : null;
}

function asPlanApproval(
  value: unknown,
): { allowedPrompts?: Array<{ tool: string; prompt: string }> } | null {
  return isObject(value)
    ? (value as { allowedPrompts?: Array<{ tool: string; prompt: string }> })
    : null;
}

function asQuestions(value: unknown): AgentQuestion[] | undefined {
  return Array.isArray(value) ? (value as AgentQuestion[]) : undefined;
}

function asPermissionMode(value: string): PermissionMode | undefined {
  if (
    value === "default" ||
    value === "acceptEdits" ||
    value === "plan" ||
    value === "auto" ||
    value === "bypassPermissions" ||
    value === "dontAsk"
  ) {
    return value;
  }
  return undefined;
}

function buildContextUsage(entry: UnifiedAgentEntry): ContextUsageState {
  return {
    inputTokens: entry.session.inputTokens,
    outputTokens: entry.session.outputTokens,
    contextWindow: normalizeContextWindow(entry.session.contextWindow),
    wasCompacted: entry.session.wasCompacted,
  };
}
