import type { LiveAgentStatus } from "@/types/agent";

/**
 * What a conversation asks of the user, highest priority first: a pending
 * request, an agent at work, a finished reply not yet read, nothing.
 */
export type AttentionState = "waiting" | "working" | "unread" | "idle";

export interface Attention {
  state: AttentionState;
  /** The conversation the state comes from: the row itself or a hidden child. */
  sourceFeatureId: number;
}

export interface FeatureAttentionInput {
  featureId: number;
  status: LiveAgentStatus;
  isUnread: boolean;
}

const RANK: Record<AttentionState, number> = { waiting: 3, working: 2, unread: 1, idle: 0 };

function attentionState(status: LiveAgentStatus, isUnread: boolean): AttentionState {
  if (status === "question") return "waiting";
  if (status === "agent") return "working";
  return isUnread ? "unread" : "idle";
}

/**
 * The one place the sidebar decides what a conversation needs, so a row, its
 * collapsed parent and any later surface can never disagree. `hidden` are the
 * conversations folded under the row (a collapsed subtree): the most urgent
 * state wins, the row itself on a tie.
 */
export function deriveAttention(
  row: FeatureAttentionInput,
  hidden: readonly FeatureAttentionInput[] = [],
): Attention {
  let best: Attention = {
    state: attentionState(row.status, row.isUnread),
    sourceFeatureId: row.featureId,
  };
  for (const input of hidden) {
    const state = attentionState(input.status, input.isUnread);
    if (RANK[state] > RANK[best.state]) best = { state, sourceFeatureId: input.featureId };
  }
  return best;
}
