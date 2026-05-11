import { get, set } from "idb-keyval";
import type { FeatureAgentStateResponse } from "@/api/generated";

/**
 * Per-feature IndexedDB cache for the latest `agent-state` response.
 *
 * Read on mount and seed React Query's cache before the network round-trip
 * resolves — blocks paint immediately while the fresh fetch is in flight.
 * Writes are throttled to one per 2 s per feature so a fast streaming
 * session doesn't pound IDB on every WebSocket tick.
 *
 * `idb-keyval` is a noop on the server / when `indexedDB` is unavailable
 * (Vitest jsdom): reads resolve to `undefined` and writes are dropped, so
 * tests don't need to mock the module.
 */
const KEY_PREFIX = "cadencr-agent-state-v1:";
const WRITE_THROTTLE_MS = 2000;

function keyFor(featureId: number): string {
  return `${KEY_PREFIX}${featureId}`;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

export async function readAgentStateCache(
  featureId: number,
): Promise<FeatureAgentStateResponse | null> {
  if (!isBrowser()) return null;
  try {
    const value = await get<FeatureAgentStateResponse>(keyFor(featureId));
    return value ?? null;
  } catch (err) {
    // IDB read errors are non-fatal: we fall through to the network fetch.
    // Surface to the dev console so a corrupted DB is debuggable.
    console.warn(`[agentStateCache] read failed for feature ${featureId}:`, err);
    return null;
  }
}

interface PendingWrite {
  value: FeatureAgentStateResponse;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Throttle map: at most one write per 2 s per feature. The latest value
 * wins — a flurry of WebSocket pushes coalesces into one IDB put.
 */
const pendingWrites = new Map<number, PendingWrite>();

function flushWrite(featureId: number): void {
  const pending = pendingWrites.get(featureId);
  if (!pending) return;
  pendingWrites.delete(featureId);
  void set(keyFor(featureId), pending.value).catch((err) => {
    // Writes are best-effort: surface for debugging but don't disturb the UI.
    console.warn(`[agentStateCache] write failed for feature ${featureId}:`, err);
  });
}

export async function writeAgentStateCache(
  featureId: number,
  value: FeatureAgentStateResponse,
): Promise<void> {
  if (!isBrowser()) return;
  const existing = pendingWrites.get(featureId);
  if (existing) {
    // Same throttle window — just update the value; the timer will flush
    // the latest one when it fires.
    existing.value = value;
    return;
  }
  const timer = setTimeout(() => flushWrite(featureId), WRITE_THROTTLE_MS);
  pendingWrites.set(featureId, { value, timer });
}
