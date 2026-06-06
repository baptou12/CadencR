/**
 * Reconnect message resync for the WS session store.
 *
 * Messages only stream over the WebSocket while it is open. When the socket
 * drops — most painfully when a mobile client sleeps — anything the agent
 * emits in the gap is persisted to the DB but never reaches this client. On
 * reconnect we therefore pull everything that landed `after` the newest
 * message we already hold and merge it in.
 *
 * Live and persisted blocks share the same `msg-<dbId>` identity, so we derive
 * the cursor from the blocks already on screen (covering messages received
 * live, which don't advance `lastAppliedMessageId`). The `after` batch then
 * contains only genuinely-missed messages, which we append in chronological
 * order — de-duped by id as a belt-and-braces guard.
 */
import { getFeatureAgentState } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import type { AgentBlockData } from "@/components/AgentBlock";
import { blocksPatchWithDerived } from "./ws-message-processing";
import { updateSession } from "./ws-session-types";
import type { StoreAccessors } from "./ws-envelope-handler";

const MSG_ID_RE = /^msg-(\d+)$/;

/** Highest `msg-<dbId>` across the block tree (0 if none). */
function maxMessageIdInBlocks(blocks: AgentBlockData[]): number {
  let max = 0;
  for (const block of blocks) {
    const match = MSG_ID_RE.exec(block.id);
    if (match) max = Math.max(max, Number(match[1]));
    if (block.childBlocks?.length) {
      max = Math.max(max, maxMessageIdInBlocks(block.childBlocks));
    }
  }
  return max;
}

export async function resyncMessagesOnReconnect(
  ctx: StoreAccessors,
  sessionId: string,
): Promise<void> {
  const session = ctx.get().sessions[sessionId];
  if (!session || !session.featureId || !session.sessionDbId) return;

  // Anchor at the newest message we hold — from the cursor seeded by the
  // initial load OR from blocks received live since (whichever is higher).
  const cursor = Math.max(session.lastAppliedMessageId ?? 0, maxMessageIdInBlocks(session.blocks));
  if (cursor <= 0) return;

  const afterParam = JSON.stringify({ [session.sessionDbId]: cursor });
  const data = await getFeatureAgentState(session.featureId, { after: afterParam });
  const serverSession = data.sessions.find((s) => s.sessionDbId === session.sessionDbId);
  if (!serverSession) return;

  const newBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);
  const current = ctx.get().sessions[sessionId];
  if (!current) return;

  const nextCursor = Math.max(cursor, serverSession.maxMessageId ?? 0);
  if (newBlocks.length === 0) {
    if (nextCursor !== current.lastAppliedMessageId) {
      ctx.set(updateSession(ctx.get(), sessionId, { lastAppliedMessageId: nextCursor }));
    }
    return;
  }

  const existingIds = new Set(current.blocks.map((b) => b.id));
  const appended = newBlocks.filter((b) => !existingIds.has(b.id));
  if (appended.length === 0) {
    ctx.set(updateSession(ctx.get(), sessionId, { lastAppliedMessageId: nextCursor }));
    return;
  }

  const merged = [...current.blocks, ...appended];
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      ...blocksPatchWithDerived(current.streamingState, merged),
      lastAppliedMessageId: nextCursor,
    }),
  );
}
