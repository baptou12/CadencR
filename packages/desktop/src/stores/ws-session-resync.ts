/**
 * Stream-loss recovery for the WS session store.
 *
 * Agent output only streams over the WebSocket while it is open, but the
 * backend always persists it first. That gap between "persisted" and
 * "delivered" is the single failure class every recovery layer below guards:
 * a dropped envelope or a slept socket must never leave the user staring at
 * text that silently stopped mid-message. There are FOUR layers, each scoped
 * to a different failure shape and firing at a different moment:
 *
 *   1. Orphan-delta synthesis  — live, in-turn, zero-network.
 *      `ws-message-processing-stream.ts` `processContentBlockDelta`. When a
 *      `content_block_delta` arrives for an index whose `content_block_start`
 *      was never applied (lost start envelope, or a start for a block type we
 *      couldn't render), it synthesises the block from the first surviving
 *      delta so this and every later chunk render. Repairs one in-flight block
 *      instantly with no DB round-trip.
 *
 *   2. Seq-gap detection       — mid-turn trigger. `trackStreamSeq` (below).
 *      Every `session.message` carries a per-stream monotonic `seq`; a skip
 *      means a whole envelope was dropped in transit. It reacts two ways:
 *      fires layer 3 *immediately* (surface any wholly-missed message now, not
 *      hours later on a long/background turn) and arms layer 4 for the turn end.
 *
 *   3. Canonical resync        — reconnect / manual / gap. `resyncMessagesOnReconnect`.
 *      Pulls every persisted row after the last server-confirmed cursor and
 *      appends the ones we lack, upserted by message UUID / DB id. Triggered by
 *      socket reconnect (onOpen, e.g. a mobile client waking), the manual
 *      "Sync from CLI" action, or a layer-2 gap. Append-ONLY: it cannot fix a
 *      block we already hold whose deltas were truncated, because that block
 *      is already present — that is layer 4's job.
 *
 *   4. Post-turn tail repair    — turn-end. `repairPersistedBlocksAfterTurn` +
 *      `repairBlockTree`. Runs at `turn_complete` when layer 2 saw a gap
 *      (`tailRepairNeeded`). With no more deltas racing in, the DB transcript is
 *      authoritative: overwrite any held block the DB has strictly more of, and
 *      graft server children that never arrived. Overwrites AND appends.
 *
 * Why layers 2+4 are not merged into one path (they look like they should be):
 * they cover complementary halves of a gap. Layer 3 (which layer 2 invokes)
 * only *appends* wholly-missed messages, and must do so immediately — the
 * guarantee that matters when a background agent streams for hours. Layer 4
 * only *overwrites/grafts* already-held blocks, and can only run once deltas
 * stop, because an in-place rewrite mid-turn would race live appends. They are
 * the two halves of one repair, split by *when each half is safe to run*, not
 * two redundant safety nets — so both stay.
 *
 * Cursor note (layers 3/4): only a completed server snapshot/resync advances
 * `lastAppliedMessageId`. A later live DB id is not a safe cursor because an
 * earlier envelope may have been dropped. Resync intentionally overlaps live
 * blocks, then merges the batch by canonical UUID / DB id.
 */
import { getFeatureAgentState } from "@/api/generated";
import { serverBlocksToAgentBlocks } from "@/hooks/useFeatureAgentState";
import type { AgentBlockData } from "@/components/AgentBlock";
import { blocksPatchWithDerived, type StreamingState } from "./ws-message-processing";
import { updateSession, type ResyncTarget } from "./ws-session-types";
import type { StoreAccessors } from "./ws-envelope-handler";
import { mergeCanonicalBlocks } from "./ws-user-message-reconciliation";

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

  // Anchor only at a cursor confirmed by a completed server response. A live
  // row with a larger DB id does not prove every earlier row was received.
  const cursor = target?.cursor ?? session.lastAppliedMessageId ?? 0;
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

  const merged = mergeCanonicalBlocks(current.blocks, newBlocks);
  if (merged === current.blocks) {
    ctx.set(updateSession(ctx.get(), sessionId, { ...idPatch, lastAppliedMessageId: nextCursor }));
    return;
  }

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

  const merged = mergeCanonicalBlocks(repaired, fetched);
  const appended = merged.length - repaired.length;

  if (!changed && appended === 0 && merged === repaired) return;
  console.warn("[ws-session] repaired stream-truncated blocks from persisted transcript", {
    replaced: changed,
    appended,
  });
  ctx.set(
    updateSession(ctx.get(), sessionId, {
      ...blocksPatchWithDerived(current.streamingState, merged),
      lastAppliedMessageId: Math.max(
        current.lastAppliedMessageId ?? 0,
        serverSession.maxMessageId ?? 0,
      ),
    }),
  );
}

function collectBlockTree(blocks: AgentBlockData[], into: Map<string, AgentBlockData>): void {
  for (const block of blocks) {
    into.set(block.id, block);
    if (block.childBlocks?.length) collectBlockTree(block.childBlocks, into);
  }
}

/**
 * Overwrite a held block's content with the persisted version when the DB has
 * strictly more of it (a lost delta always leaves the client behind, never
 * ahead — the backend persists before it forwards). Recurses into children and
 * grafts on any server children that never arrived (a lost `content_block_start`
 * under a task/tool parent), so a whole subtree isn't left missing. Returns the
 * original reference when nothing changed so React sees no-ops.
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

  const heldChildren = block.childBlocks ?? [];
  const serverChildren = server?.childBlocks ?? [];
  // Leaf on both sides: nothing to repair or graft — skip all per-node work.
  if (heldChildren.length === 0 && serverChildren.length === 0) return next;

  // Rebuild children in the authoritative server order, preferring the repaired
  // held version, and grafting any server children we never received (a lost
  // `content_block_start` under a task/tool parent). Server order is display
  // order, so appending missing children at the end would misplace one that was
  // lost from the middle. Held-only children (not yet on the server) trail.
  const repairedById = new Map(
    heldChildren.map((child) => [child.id, repairBlockTree(child, serverById, markChanged)]),
  );
  const serverIds = new Set(serverChildren.map((child) => child.id));
  const mergedChildren = [
    ...serverChildren.map((child) => repairedById.get(child.id) ?? child),
    ...heldChildren
      .filter((child) => !serverIds.has(child.id))
      .map((child) => repairedById.get(child.id) ?? child),
  ];

  const childrenChanged =
    mergedChildren.length !== heldChildren.length ||
    mergedChildren.some((child, i) => child !== heldChildren[i]);
  if (childrenChanged) {
    markChanged();
    next = { ...next, childBlocks: mergedChildren };
  }

  return next;
}
