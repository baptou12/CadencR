import {
  countByProject,
  type ResolvedAttention,
  type ResolvedAttentionResult,
} from "@/hooks/useResolvedAttention";
import { buildAttentionIndex } from "@/lib/attention-index";
import { needsUser, type AttentionState } from "@/lib/sidebar-attention";
import type { SampleConversation } from "@/lib/sidebar-sample-data";

/** A sample conversation with the state it shows right now. */
export interface SampleRow {
  conversation: SampleConversation;
  state: AttentionState;
}

export interface SampleViews {
  /** What the collapsed rail and the folded projects' badges read, as the live sidebar resolves it. */
  attention: ResolvedAttentionResult;
  forMe: readonly SampleRow[];
  working: readonly SampleRow[];
  recent: readonly SampleRow[];
  pinned: readonly SampleRow[];
}

function lastActivity(row: SampleRow): string {
  const { feature } = row.conversation;
  return feature.last_activity_at ?? feature.created_at;
}

/** Everything the blocks, the folded projects and the rail show, picked the way the live sidebar picks it. */
export function sampleViews(rows: readonly SampleRow[], recentCount: number): SampleViews {
  const oldestFirst = [...rows].sort((a, b) => lastActivity(a).localeCompare(lastActivity(b)));
  const ids = (state: AttentionState) =>
    oldestFirst.filter((row) => row.state === state).map((row) => row.conversation.feature.id);
  const entries = buildAttentionIndex(
    { waiting: ids("waiting"), working: ids("working") },
    { failed: ids("failed"), unread: ids("unread") },
  );
  const byId = new Map(rows.map((row) => [row.conversation.feature.id, row]));
  const items = entries.flatMap((entry): ResolvedAttention[] => {
    const row = byId.get(entry.featureId);
    return row ? [{ feature: row.conversation.feature, state: entry.state }] : [];
  });
  const queue = items.filter((item) => needsUser(item.state));
  const rowsOf = (list: readonly ResolvedAttention[]) =>
    list.flatMap((item) => byId.get(item.feature.id) ?? []);
  return {
    attention: { entries, items, queue, byProject: countByProject(items), loadingStates: [] },
    forMe: rowsOf(queue),
    working: rowsOf(items.filter((item) => item.state === "working")),
    recent: oldestFirst.slice(Math.max(0, oldestFirst.length - recentCount)).reverse(),
    pinned: rows.filter((row) => row.conversation.feature.is_pinned),
  };
}
