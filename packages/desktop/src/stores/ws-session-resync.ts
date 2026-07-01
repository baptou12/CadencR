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
import { blocksPatchWithDerived, type StreamingState } from "./ws-message-processing";
import { updateSession, type ResyncTarget } from "./ws-session-types";
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
  target?: ResyncTarget,
): Promise<void> {
  const session = ctx.get().sessions[sessionId];
  if (!session) return;

  // Reconnect derives the conversation key, session id, and cursor from the
  // store. The manual "Sync from CLI" action passes them explicitly: a session
  // born live this run never hydrated from REST, so its store `sessionDbId` is
  // a stale fallback and its blocks may lack persisted ids — the backend hands
  // back the authoritative `sessionDbId` plus the pre-append `cursor` so we
  // fetch *only* the rows it just appended.
  const featureId = target?.featureId ?? session.featureId;
  const sessionDbId = target?.sessionDbId ?? session.sessionDbId;
  if (!featureId || !sessionDbId) return;

  // Anchor at the newest message we hold — from the cursor seeded by the
  // initial load OR from blocks received live since (whichever is higher).
  const cursor =
    target?.cursor ??
    Math.max(session.lastAppliedMessageId ?? 0, maxMessageIdInBlocks(session.blocks));
  // Reconnect with no prior anchor has nothing to fetch after.
  if (!target && cursor <= 0) return;

  const afterParam = JSON.stringify({ [sessionDbId]: cursor });
  const data = await getFeatureAgentState(featureId, { after: afterParam });
  const serverSession = data.sessions.find((s) => s.sessionDbId === sessionDbId);
  if (!serverSession) return;

  const newBlocks = serverBlocksToAgentBlocks(serverSession.blocks as never[]);
  const current = ctx.get().sessions[sessionId];
  if (!current) return;

  // Persist the authoritative session id so future resyncs/status lookups key
  // correctly when the stored one was a stale live fallback.
  const idPatch = current.sessionDbId === sessionDbId ? {} : { sessionDbId };
  const nextCursor = Math.max(cursor, serverSession.maxMessageId ?? 0);

  if (newBlocks.length === 0) {
    ctx.set(updateSession(ctx.get(), sessionId, { ...idPatch, lastAppliedMessageId: nextCursor }));
    return;
  }

  const existingIds = new Set(current.blocks.map((b) => b.id));
  const appended = newBlocks.filter((b) => !existingIds.has(b.id));
  if (appended.length === 0) {
    ctx.set(updateSession(ctx.get(), sessionId, { ...idPatch, lastAppliedMessageId: nextCursor }));
    return;
  }

  const merged = [...current.blocks, ...appended];
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      ...idPatch,
      ...blocksPatchWithDerived(current.streamingState, merged),
      lastAppliedMessageId: nextCursor,
    }),
  );
}

/**
 * Detect a dropped `session.message` envelope via the backend's per-stream
 * `seq` stamp. A gap means content was lost in transit — resync missed rows
 * from the DB now, and mark the stream for a tail repair at turn end (a
 * truncated in-flight block can't be rewritten while deltas still race in).
 * A seq lower than expected is a stream-reader restart, not a gap.
 */
export function trackStreamSeq(
  ctx: StoreAccessors,
  sessionId: string,
  state: StreamingState,
  seq: number | null,
): void {
  if (seq == null) return;
  const last = state.lastMessageSeq;
  state.lastMessageSeq = seq;
  if (last == null || seq <= last + 1) return;
  console.warn("[ws-session] stream envelope gap detected; resyncing", {
    expected: last + 1,
    received: seq,
  });
  state.tailRepairNeeded = true;
  resyncMessagesOnReconnect(ctx, sessionId).catch((err: unknown) => {
    console.warn("[ws-session] gap resync failed; tail repair will retry at turn end", err);
  });
}

/**
 * Post-turn repair for a stream that dropped envelopes mid-turn (detected via
 * the `seq` gap). The reconnect resync above only *appends* missed rows — a
 * block we already hold whose deltas were lost stays truncated because its id
 * is deduped. Once the turn has ended (no more in-flight deltas to race), the
 * DB is the authoritative transcript: refetch it and overwrite any held block
 * whose persisted content is longer than what we rendered.
 */
export async function repairPersistedBlocksAfterTurn(
  ctx: StoreAccessors,
  sessionId: string,
): Promise<void> {
  const session = ctx.get().sessions[sessionId];
  if (!session?.featureId || !session.sessionDbId) return;

  const data = await getFeatureAgentState(session.featureId);
  const serverSession = data.sessions.find((s) => s.sessionDbId === session.sessionDbId);
  if (!serverSession) return;

  const fetched = serverBlocksToAgentBlocks(serverSession.blocks as never[]);
  const current = ctx.get().sessions[sessionId];
  if (!current) return;

  const serverById = new Map<string, AgentBlockData>();
  collectBlockTree(fetched, serverById);

  let changed = false;
  const markChanged = () => {
    changed = true;
  };
  const repaired = current.blocks.map((block) => repairBlockTree(block, serverById, markChanged));

  const heldIds = new Set<string>();
  collectBlockTree(current.blocks, heldIds);
  const appended = fetched.filter((b) => !heldIds.has(b.id));

  if (!changed && appended.length === 0) return;
  console.warn("[ws-session] repaired stream-truncated blocks from persisted transcript", {
    replaced: changed,
    appended: appended.length,
  });
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      ...blocksPatchWithDerived(current.streamingState, [...repaired, ...appended]),
      lastAppliedMessageId: Math.max(
        current.lastAppliedMessageId ?? 0,
        serverSession.maxMessageId ?? 0,
      ),
    }),
  );
}

function collectBlockTree(
  blocks: AgentBlockData[],
  into: Map<string, AgentBlockData> | Set<string>,
): void {
  for (const block of blocks) {
    if (into instanceof Set) {
      into.add(block.id);
    } else {
      into.set(block.id, block);
    }
    if (block.childBlocks?.length) collectBlockTree(block.childBlocks, into);
  }
}

/**
 * Overwrite a held block's content with the persisted version when the DB has
 * strictly more of it (a lost delta always leaves the client behind, never
 * ahead — the backend persists before it forwards). Recurses into children;
 * returns the original reference when nothing changed so React sees no-ops.
 */
function repairBlockTree(
  block: AgentBlockData,
  serverById: Map<string, AgentBlockData>,
  markChanged: () => void,
): AgentBlockData {
  let next = block;

  const server = serverById.get(block.id);
  if (server && server.content !== block.content && server.content.length > block.content.length) {
    next = { ...block, content: server.content, toolArgs: server.toolArgs ?? block.toolArgs };
    markChanged();
  }

  if (block.childBlocks?.length) {
    const children = block.childBlocks.map((child) =>
      repairBlockTree(child, serverById, markChanged),
    );
    if (children.some((child, i) => child !== block.childBlocks?.[i])) {
      next = { ...next, childBlocks: children };
    }
  }

  return next;
}
