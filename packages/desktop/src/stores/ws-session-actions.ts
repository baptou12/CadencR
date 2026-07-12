import { createPermissionRespond, createPromptSend, type WsEnvelope } from "@/lib/ws-envelope";
import { getFeatureAgentState } from "@/api/generated";
import { AGENT_STATE_OLDER_MESSAGE_LIMIT } from "@/lib/agent-state-limits";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import { countRenderableDisplayRows, type DisplayRowMode } from "@/components/agentStreamDisplay";
import { blocksPatchWithDerived } from "./ws-message-processing";
import type { StoreAccessors } from "./ws-envelope-handler";
import { markLastPlanBlock, type PersistedStatePayload, updateSession } from "./ws-session-types";
import { transitionTurn } from "./ws-turn-lifecycle";

export type { PersistedStatePayload };

export function applyApprovePlan(
  ctx: StoreAccessors,
  sessionId: string,
  sendRaw: (sessionId: string, envelope: WsEnvelope) => void,
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

  const blocksPatch = blocksPatchWithDerived(session.streamingState, updatedBlocks);

  // The post-plan-approval mode change is owned by the backend bridge: it
  // calls `Query::set_permission_mode` on the live CLI atomically with
  // returning `Allow`, then broadcasts `mode.changed`. Any local write
  // here would race the CLI and let the chip lie about CLI state, so the
  // chip waits for that envelope instead (see no-optimistic-updates.md).

  if (session.pendingRequestId) {
    const isRestored = session.pendingRequestId.startsWith(planRestorePrefix);
    sendRaw(
      sessionId,
      createPermissionRespond(session.serverSessionId, session.pendingRequestId, "allow_once"),
    );
    if (isRestored) {
      sendRaw(
        sessionId,
        createPromptSend(session.serverSessionId, "Plan approved. Proceed with execution."),
      );
    }
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        pendingRequestId: "",
        pendingPlanApproval: null,
        ...blocksPatch,
        lifecycle: transitionTurn(session.lifecycle, { type: "plan_approved" }),
      }),
    );
    return;
  }

  sendRaw(
    sessionId,
    createPromptSend(
      session.serverSessionId,
      "Plan approved. Exit plan mode and proceed with execution.",
    ),
  );
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      pendingPlanApproval: null,
      ...blocksPatch,
      lifecycle: transitionTurn(session.lifecycle, { type: "plan_approved" }),
    }),
  );
}

export function applyPlanChangesRequest(
  ctx: StoreAccessors,
  sessionId: string,
  feedback: string,
  sendRaw: (sessionId: string, envelope: WsEnvelope) => void,
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

  const blocksPatch = blocksPatchWithDerived(session.streamingState, blocksWithFeedback);

  if (session.pendingRequestId) {
    const isRestored = session.pendingRequestId.startsWith(planRestorePrefix);
    sendRaw(
      sessionId,
      createPermissionRespond(session.serverSessionId, session.pendingRequestId, "deny", {
        feedback,
      }),
    );
    if (isRestored) {
      sendRaw(
        sessionId,
        createPromptSend(session.serverSessionId, feedback || "Plan rejected. Revise the plan."),
      );
    }
    ctx.set(
      updateSession(ctx.get(), sessionId, {
        pendingRequestId: "",
        pendingPlanApproval: null,
        ...blocksPatch,
        lifecycle: transitionTurn(session.lifecycle, { type: "plan_changes_requested" }),
      }),
    );
    return;
  }

  sendRaw(sessionId, createPromptSend(session.serverSessionId, feedback));
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      pendingPlanApproval: null,
      ...blocksPatch,
      lifecycle: transitionTurn(session.lifecycle, { type: "plan_changes_requested" }),
    }),
  );
}

export { applyPersistedState } from "./ws-session-persisted-actions";

/**
 * Load older messages for a session from the server. Returns the number of
 * blocks that were prepended. The store also tracks the rendered display-row
 * delta so Virtuoso can preserve scroll position via `firstItemIndex`.
 */
export async function loadOlderSessionMessages(
  ctx: StoreAccessors,
  sessionId: string,
  displayMode?: DisplayRowMode,
): Promise<number> {
  const session = ctx.get().sessions[sessionId];
  if (
    !session ||
    !session.hasMore ||
    session.oldestMessageId == null ||
    !session.featureId ||
    !session.sessionDbId
  )
    return 0;

  const beforeParam = JSON.stringify({ [session.sessionDbId]: session.oldestMessageId });
  const data = await getFeatureAgentState(session.featureId, {
    before: beforeParam,
    limit: AGENT_STATE_OLDER_MESSAGE_LIMIT,
  });

  const serverSession = data.sessions.find((s) => s.sessionDbId === session.sessionDbId);
  if (!serverSession) {
    ctx.set(updateSession(ctx.get(), sessionId, { hasMore: false }));
    return 0;
  }

  const olderBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);
  const currentSession = ctx.get().sessions[sessionId];
  if (!currentSession) return 0;
  const mergedBlocks = [...olderBlocks, ...currentSession.blocks];
  // Use the actual growth in rendered rows, not the older chunk's rows in
  // isolation — under summary/compact mode a segment can span the chunk
  // boundary, so the net delta is what keeps `firstItemIndex` aligned.
  const prependedDisplayRows =
    countRenderableDisplayRows(mergedBlocks, displayMode) -
    countRenderableDisplayRows(currentSession.blocks, displayMode);
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      ...blocksPatchWithDerived(currentSession.streamingState, mergedBlocks),
      historyPrependDisplayOffset:
        currentSession.historyPrependDisplayOffset + prependedDisplayRows,
      hasMore: serverSession.hasMore ?? false,
      oldestMessageId: serverSession.oldestMessageId ?? null,
    }),
  );
  return olderBlocks.length;
}

/** Format question answers into a user-visible markdown string. */
export function formatQuestionResponse(
  pendingQuestionToolInput: Record<string, unknown>,
  response: Array<string[]>,
): string {
  const questions = Array.isArray(pendingQuestionToolInput.questions)
    ? pendingQuestionToolInput.questions
    : pendingQuestionToolInput.question != null
      ? [pendingQuestionToolInput]
      : [];
  return response
    .map((answerGroup, index) => {
      const rawQuestion = questions[index] as Record<string, unknown> | undefined;
      const question =
        typeof rawQuestion === "object" &&
        rawQuestion != null &&
        typeof rawQuestion.question === "string"
          ? (rawQuestion.question as string)
          : `Question ${index + 1}`;
      return `*${question}*\n\n**${answerGroup.join("\n")}**`;
    })
    .join("\n\n\n\n");
}
