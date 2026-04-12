import {
  createModeSet,
  createPermissionRespond,
  createPromptSend,
} from "@/lib/ws-envelope";
import { resolveLegacyClaudeSessionId } from "@/lib/providers";
import { injectPlanIntoBlocks, parseTodosFromBlocks } from "./ws-message-processing";
import type { StoreAccessors } from "./ws-envelope-handler";
import {
  markLastPlanBlock,
  type PendingPlanApproval,
  type SessionEntry,
  updateSession,
} from "./ws-session-types";

export interface PersistedStatePayload {
  blocks: SessionEntry["blocks"];
  status: SessionEntry["status"];
  hasMore?: boolean;
  oldestMessageId?: number | null;
  featureId?: number;
  sessionDbId?: number;
  currentProviderId?: string;
  currentModelId?: string;
  runtimeProvider?: string | null;
  runtimeSessionId?: string | null;
  pendingPlanApproval?: PendingPlanApproval | null;
}

export function applyApprovePlan(
  ctx: StoreAccessors,
  sessionId: string,
  sendRaw: (sessionId: string, data: unknown) => void,
  planRestorePrefix: string,
): void {
  const session = ctx.getSession(sessionId);
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
    const isRestored = session.pendingRequestId.startsWith(planRestorePrefix);
    sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
    sendRaw(
      sessionId,
      createPermissionRespond(
        session.serverSessionId,
        session.pendingRequestId,
        "allow_once",
      ),
    );
    if (isRestored) {
      sendRaw(
        sessionId,
        createPromptSend(
          session.serverSessionId,
          "Plan approved. Proceed with execution.",
        ),
      );
    }
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        pendingRequestId: "",
        pendingPlanApproval: null,
        permissionMode: "acceptEdits",
        blocks: updatedBlocks,
        status: "running",
      }),
    );
    return;
  }

  sendRaw(sessionId, createModeSet(session.serverSessionId, "acceptEdits"));
  sendRaw(
    sessionId,
    createPromptSend(
      session.serverSessionId,
      "Plan approved. Exit plan mode and proceed with execution.",
    ),
  );
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      permissionMode: "acceptEdits",
      pendingPlanApproval: null,
      blocks: updatedBlocks,
      status: "running",
    }),
  );
}

export function applyPlanChangesRequest(
  ctx: StoreAccessors,
  sessionId: string,
  feedback: string,
  sendRaw: (sessionId: string, data: unknown) => void,
  planRestorePrefix: string,
): void {
  const session = ctx.getSession(sessionId);
  const blocksWithStatus = markLastPlanBlock(session.blocks, "rejected");
  session.streamingState.counter += 1;
  const blocksWithFeedback = feedback
    ? [
        ...blocksWithStatus,
        {
          id: `ws-user-${session.streamingState.counter}`,
          type: "user_message" as const,
          content: feedback,
          isError: false,
          createdAt: new Date().toISOString(),
        },
      ]
    : blocksWithStatus;

  if (session.pendingRequestId) {
    const isRestored = session.pendingRequestId.startsWith(planRestorePrefix);
    sendRaw(
      sessionId,
      createPermissionRespond(
        session.serverSessionId,
        session.pendingRequestId,
        "deny",
        undefined,
        feedback,
      ),
    );
    if (isRestored) {
      sendRaw(
        sessionId,
        createPromptSend(
          session.serverSessionId,
          feedback || "Plan rejected. Revise the plan.",
        ),
      );
    }
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        pendingRequestId: "",
        pendingPlanApproval: null,
        blocks: blocksWithFeedback,
        status: "running",
      }),
    );
    return;
  }

  sendRaw(sessionId, createPromptSend(session.serverSessionId, feedback));
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      pendingPlanApproval: null,
      blocks: blocksWithFeedback,
      status: "running",
    }),
  );
}

export function applyPersistedState(
  ctx: StoreAccessors,
  sessionId: string,
  payload: PersistedStatePayload,
  planRestorePrefix: string,
): void {
  const {
    blocks,
    status,
    hasMore,
    oldestMessageId,
    featureId,
    sessionDbId,
    currentProviderId,
    currentModelId,
    runtimeProvider,
    runtimeSessionId,
    pendingPlanApproval,
  } = payload;

  const resolvedProviderId = currentProviderId ?? runtimeProvider ?? undefined;
  const resolvedRuntimeProvider = runtimeProvider ?? currentProviderId ?? undefined;
  const resolvedRuntimeSessionId = runtimeSessionId ?? undefined;
  const legacyClaudeSessionId = resolveLegacyClaudeSessionId(
    resolvedRuntimeProvider,
    resolvedRuntimeSessionId,
  );
  const existing = ctx.get().sessions[sessionId];
  const sessionMetaPatch: Partial<SessionEntry> = {
    persistedLoaded: true,
    hasMore: hasMore ?? false,
    oldestMessageId: oldestMessageId ?? null,
    featureId: featureId ?? null,
    sessionDbId: sessionDbId ?? null,
    ...(resolvedProviderId ? { currentProviderId: resolvedProviderId } : {}),
    ...(currentModelId ? { currentModelId } : {}),
    ...(resolvedRuntimeProvider ? { runtimeProvider: resolvedRuntimeProvider } : {}),
    ...(resolvedRuntimeSessionId ? { runtimeSessionId: resolvedRuntimeSessionId } : {}),
    ...(legacyClaudeSessionId !== undefined
      ? { claudeSessionId: legacyClaudeSessionId }
      : {}),
    ...(pendingPlanApproval != null
      ? { pendingPlanApproval, status: "paused" as const }
      : {}),
  };

  if (existing && existing.blocks.length > 0) {
    ctx.set(updateSession(ctx.get(), sessionId, sessionMetaPatch));
    return;
  }

  const enrichedBlocks = injectPlanIntoBlocks(blocks, pendingPlanApproval);
  const todos = parseTodosFromBlocks(enrichedBlocks);
  const restoredRequestId =
    pendingPlanApproval != null ? `${planRestorePrefix}${Date.now()}` : "";

  ctx.set(
    updateSession(ctx.get(), sessionId, {
      ...sessionMetaPatch,
      blocks: enrichedBlocks,
      status: pendingPlanApproval != null ? "paused" : status,
      ...(todos ? { todos } : {}),
      ...(pendingPlanApproval != null
        ? { pendingRequestId: restoredRequestId }
        : {}),
    }),
  );
}
