import { useSessionStatusStore } from "@/stores/session-status-store";

/**
 * Among all sessions awaiting the user, pick the feature whose pending
 * status event is most recent (`seq`, then `sessionId` as tiebreak).
 * Used so only one sidebar pending-gate popover auto-opens at a time.
 */
export function useMostRecentPendingFeatureId(): number | null {
  return useSessionStatusStore((s) => {
    let bestFeatureId: number | null = null;
    let bestSeq = -1;
    let bestSessionId = -1;
    for (const [idKey, entry] of Object.entries(s.bySession)) {
      if (entry.status !== "question") continue;
      const sessionId = Number(idKey);
      if (entry.seq > bestSeq || (entry.seq === bestSeq && sessionId > bestSessionId)) {
        bestSeq = entry.seq;
        bestSessionId = sessionId;
        bestFeatureId = entry.featureId;
      }
    }
    return bestFeatureId;
  });
}

/** Live pending `request_id` for a feature, if any session is in `question`. */
export function useFeaturePendingRequestId(featureId: number): string | null {
  return useSessionStatusStore((s) => {
    let best: { requestId: string | null; seq: number } | null = null;
    for (const entry of Object.values(s.bySession)) {
      if (entry.featureId !== featureId) continue;
      if (entry.status !== "question") continue;
      if (!best || entry.seq > best.seq) {
        best = { requestId: entry.requestId ?? null, seq: entry.seq };
      }
    }
    return best?.requestId ?? null;
  });
}
