import { useShallow } from "zustand/react/shallow";
import type { LiveAgentStatus, PendingKind } from "@/types/agent";
import { useSessionStatusStore, type SessionStatusEntry } from "@/stores/session-status-store";

export function aggregateFeatureStatus(entries: readonly SessionStatusEntry[]): {
  status: LiveAgentStatus;
  kind: PendingKind | null;
} {
  let best: { status: LiveAgentStatus; kind: PendingKind | null } = {
    status: "idle",
    kind: null,
  };
  for (const e of entries) {
    if (e.status === "question") {
      if (best.status !== "question") best = { status: "question", kind: e.kind };
    } else if (e.status === "agent" && best.status === "idle") {
      best = { status: "agent", kind: null };
    }
  }
  return best;
}

const EMPTY_FEATURE_STATUS: {
  status: LiveAgentStatus;
  kind: PendingKind | null;
} = { status: "idle", kind: null };

export function useSessionStatus(sessionId: number | null | undefined): SessionStatusEntry | null {
  return useSessionStatusStore((s) =>
    sessionId == null ? null : (s.bySession[sessionId] ?? null),
  );
}

export function useFeatureStatus(featureId: number | null | undefined): {
  status: LiveAgentStatus;
  kind: PendingKind | null;
} {
  return useSessionStatusStore(
    useShallow((s) => {
      if (featureId == null) return EMPTY_FEATURE_STATUS;
      let best = EMPTY_FEATURE_STATUS;
      for (const id in s.bySession) {
        const entry = s.bySession[Number(id)];
        if (!entry) continue;
        if (entry.featureId !== featureId) continue;
        if (entry.status === "question") return { status: "question", kind: entry.kind };
        if (entry.status === "agent" && best.status === "idle") {
          best = { status: "agent", kind: null };
        }
      }
      return best;
    }),
  );
}

export function useLiveWorkingCount(sessionIds: readonly number[]): number {
  return useSessionStatusStore((s) => {
    let count = 0;
    for (const id of sessionIds) {
      if (s.bySession[id]?.status === "agent") count++;
    }
    return count;
  });
}

export function useLiveTotalWorkingCount(): number {
  return useSessionStatusStore((s) => {
    let count = 0;
    for (const entry of Object.values(s.bySession)) {
      if (entry.status === "agent") count++;
    }
    return count;
  });
}

export function useLiveActiveSessionIds(): readonly number[] {
  return useSessionStatusStore(
    useShallow((s) => {
      const ids: number[] = [];
      for (const [k, v] of Object.entries(s.bySession)) {
        if (v.status !== "idle") ids.push(Number(k));
      }
      ids.sort((a, b) => a - b);
      return ids;
    }),
  );
}
