/**
 * Pure helpers + envelope-routing for `session-status-store`.
 *
 * Extracted to keep the store file under the 400-line limit. The store
 * still owns the WebSocket lifecycle and Zustand wiring; this file holds
 * the snapshot/update reducers, value validators, feature-lookup, and
 * notification trigger that the store imports.
 */
import { queryClient, invalidateByUrlPrefix } from "@/lib/queryClient";
import { getListFeaturesQueryKey, type Feature } from "@/api/generated";
import { notifyAgentDone, notifyAgentNeedsInput } from "@/lib/notify-agent-done";
import { handleGitEnvelope } from "@/stores/ws-git-status-handler";
import type { LiveAgentStatus, PendingKind } from "@/types/agent";
import type { SessionStatusEntry } from "@/stores/session-status-store";

const STATUS_VALUES: LiveAgentStatus[] = ["idle", "agent", "question"];
const PENDING_KIND_VALUES: PendingKind[] = [
  "permission",
  "question",
  "plan-approval",
  "prd-approval",
];

export function isStatus(val: unknown): val is LiveAgentStatus {
  return typeof val === "string" && (STATUS_VALUES as string[]).includes(val);
}

export function isPendingKind(val: unknown): val is PendingKind {
  return typeof val === "string" && (PENDING_KIND_VALUES as string[]).includes(val);
}

function lookupFeature(featureId: number): Feature | undefined {
  // Prefix-match all per-project listFeatures caches via the orval-generated key.
  const queries = queryClient.getQueriesData<Feature[]>({ queryKey: getListFeaturesQueryKey() });
  for (const [, data] of queries) {
    const feature = data?.find((f) => f.id === featureId);
    if (feature) return feature;
  }
  return undefined;
}

export function notifyTransition(
  featureId: number,
  prevStatus: LiveAgentStatus | undefined,
  nextStatus: LiveAgentStatus,
): void {
  const feature = lookupFeature(featureId);
  if (!feature) return;
  const routeType = feature.type === "ws-session" ? ("session" as const) : ("workflow" as const);
  const opts = {
    featureTitle: feature.title,
    featureId,
    projectId: feature.project_id,
    routeType,
  };
  if (nextStatus === "question" && prevStatus !== "question") {
    notifyAgentNeedsInput(opts);
  } else if (nextStatus === "idle" && prevStatus === "agent") {
    notifyAgentDone({ ...opts, status: "completed" });
  }
}

/**
 * Apply a `session_status.snapshot` envelope to the per-session map. Pure
 * over `prev` — see store comments for the seq-merge invariants.
 */
export function applySnapshot(
  prev: Record<number, SessionStatusEntry>,
  payload: Record<string, unknown>,
): Record<number, SessionStatusEntry> {
  const rawStates = (payload.states ?? {}) as Record<string, unknown>;
  const snapshotSeq = typeof payload.seq === "number" ? payload.seq : 0;
  const next: Record<number, SessionStatusEntry> = {};

  for (const [idKey, entryRaw] of Object.entries(rawStates)) {
    const sessionId = Number(idKey);
    if (!Number.isFinite(sessionId)) continue;
    if (!entryRaw || typeof entryRaw !== "object") continue;
    const obj = entryRaw as Record<string, unknown>;
    const featureId = typeof obj.feature_id === "number" ? obj.feature_id : null;
    if (featureId == null) continue;
    const status = isStatus(obj.status) ? obj.status : null;
    if (!status) continue;
    const kind = isPendingKind(obj.kind) ? obj.kind : null;

    // Preserve a more recent live entry if it has overtaken the snapshot.
    const existing = prev[sessionId];
    if (existing && existing.seq > snapshotSeq) {
      next[sessionId] = existing;
      continue;
    }
    next[sessionId] = { status, kind, featureId, seq: snapshotSeq };

    if (status === "question" && existing?.status !== "question") {
      notifyTransition(featureId, existing?.status, status);
    }
  }

  // Carry over live entries with seq > snapshotSeq that the snapshot
  // didn't include (the backend filters Idle entries from snapshots, so
  // a live "agent" event arriving just before the snapshot must be
  // preserved here).
  for (const [idKey, entry] of Object.entries(prev)) {
    const sessionId = Number(idKey);
    if (!Number.isFinite(sessionId)) continue;
    if (sessionId in next) continue;
    if (entry.seq > snapshotSeq) {
      next[sessionId] = entry;
    }
  }

  return next;
}

/**
 * Apply a `session_status.update` envelope. Returns the patched map plus
 * the prev/next status pair so the caller can fire native notifications.
 */
export function applyUpdate(
  prev: Record<number, SessionStatusEntry>,
  payload: Record<string, unknown>,
): {
  next: Record<number, SessionStatusEntry> | null;
  featureId: number | null;
  prevStatus: LiveAgentStatus | undefined;
  nextStatus: LiveAgentStatus | null;
} {
  const sessionId = typeof payload.session_id === "number" ? payload.session_id : null;
  const featureId = typeof payload.feature_id === "number" ? payload.feature_id : null;
  const seq = typeof payload.seq === "number" ? payload.seq : 0;
  if (sessionId == null || featureId == null) {
    return { next: null, featureId: null, prevStatus: undefined, nextStatus: null };
  }
  if (!isStatus(payload.status)) {
    return { next: null, featureId, prevStatus: undefined, nextStatus: null };
  }
  const kind = isPendingKind(payload.kind) ? payload.kind : null;

  const existing = prev[sessionId];
  if (existing && seq <= existing.seq) {
    // Out-of-order — drop.
    return { next: null, featureId, prevStatus: existing.status, nextStatus: payload.status };
  }

  const sameValue =
    existing?.status === payload.status &&
    (existing?.kind ?? null) === kind &&
    existing?.featureId === featureId;

  if (sameValue) {
    // Skipping the `set` keeps every selector subscribed to `bySession`
    // referentially stable through the long Agent-streaming runs.
    return { next: null, featureId, prevStatus: existing.status, nextStatus: payload.status };
  }

  return {
    next: {
      ...prev,
      [sessionId]: { status: payload.status, kind, featureId, seq },
    },
    featureId,
    prevStatus: existing?.status,
    nextStatus: payload.status,
  };
}

/**
 * Route a non-status app envelope (file-tree invalidation, git events).
 * The session-status reducers are dispatched separately by the store.
 */
export function handleAppEnvelope(
  domain: string,
  action: string,
  payload: Record<string, unknown>,
): boolean {
  if (domain === "editor" && action === "file_tree.changed") {
    void invalidateByUrlPrefix(queryClient, [
      "/api/editor/tree",
      "/api/editor/search",
      "/api/git/stats",
      "/api/git/diff",
    ]);
    return true;
  }
  if (domain === "git") {
    handleGitEnvelope(action, payload);
    return true;
  }
  return false;
}
