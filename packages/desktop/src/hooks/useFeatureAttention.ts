import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { deriveAttention, type Attention } from "@/lib/sidebar-attention";
import { aggregateFeatureStatuses, useFeatureStatus } from "@/stores/session-status-selectors";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { useUnreadStore } from "@/stores/unread-store";
import type { LiveAgentStatus } from "@/types/agent";

const NO_IDS: readonly number[] = [];
const NO_STATUSES: readonly LiveAgentStatus[] = [];
const NO_FLAGS: readonly boolean[] = [];

/**
 * What a sidebar row should signal: its own state, or the most urgent one among
 * `hiddenIds` (conversations folded under it). Subscribes to just these ids'
 * statuses and unread flags, so other conversations' pushes don't re-render it,
 * and a row with nothing folded under it allocates nothing per push.
 */
export function useFeatureAttention(
  featureId: number,
  hiddenIds: readonly number[] = NO_IDS,
): Attention {
  const { status } = useFeatureStatus(featureId);
  const isUnread = useUnreadStore((state) => state.byFeature[featureId] === true);
  const hiddenStatuses = useSessionStatusStore(
    useShallow((state) =>
      hiddenIds.length === 0 ? NO_STATUSES : aggregateFeatureStatuses(state.bySession, hiddenIds),
    ),
  );
  const hiddenUnread = useUnreadStore(
    useShallow((state) =>
      hiddenIds.length === 0 ? NO_FLAGS : hiddenIds.map((id) => state.byFeature[id] === true),
    ),
  );
  return useMemo(
    () =>
      deriveAttention(
        { featureId, status, isUnread },
        hiddenIds.map((id, position) => ({
          featureId: id,
          status: hiddenStatuses[position] ?? "idle",
          isUnread: hiddenUnread[position] ?? false,
        })),
      ),
    [featureId, status, isUnread, hiddenIds, hiddenStatuses, hiddenUnread],
  );
}
