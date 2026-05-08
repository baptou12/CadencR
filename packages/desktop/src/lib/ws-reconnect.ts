/**
 * Per-key exponential-backoff WebSocket reconnection manager.
 *
 * Two layers:
 *
 * 1. `scheduleReconnect(key, fn)` — fire-once, exponential-backoff timer
 *    used by every WS-owning store (`ws-session`, terminal, workflow,
 *    session-status). Each call registers `fn` as the "current connector"
 *    for that key so external code can later trigger it via §2.
 *
 * 2. `forceReconnectAll()` / `forceReconnect(key)` — used by the
 *    connection watchdog (visibility / online / wake) to reset every
 *    backoff and reconnect immediately, instead of waiting for the next
 *    scheduled tick. Resetting the backoff matters: after a long sleep
 *    we'd otherwise be at the 30 s ceiling and the user would stare at
 *    "Reconnecting…" for half a minute on a connection that's actually
 *    healthy again.
 */

const BASE_MS = 1000;
const MAX_MS = 30000;

interface ReconnectEntry {
  timer: ReturnType<typeof setTimeout> | null;
  delay: number;
  /** Latest connector seen for this key. Updated on every `scheduleReconnect`. */
  connect: (() => void) | null;
}

const entries = new Map<string, ReconnectEntry>();

function getOrCreate(key: string): ReconnectEntry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { timer: null, delay: BASE_MS, connect: null };
    entries.set(key, entry);
  }
  return entry;
}

export function scheduleReconnect(key: string, connect: () => void): void {
  const entry = getOrCreate(key);
  entry.connect = connect;
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    connect();
  }, entry.delay);
  entry.delay = Math.min(entry.delay * 2, MAX_MS);
}

export function resetReconnectDelay(key: string): void {
  const entry = entries.get(key);
  if (entry) entry.delay = BASE_MS;
}

export function clearReconnect(key: string): void {
  const entry = entries.get(key);
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entries.delete(key);
}

/**
 * Register a connector without scheduling a retry. Used by hooks/stores
 * that want to be reachable from `forceReconnectAll()` even before they've
 * suffered a close (e.g. terminals: connect once and stay connected, but
 * still reconnectable on wake).
 */
export function registerReconnector(key: string, connect: () => void): void {
  getOrCreate(key).connect = connect;
}

export function unregisterReconnector(key: string): void {
  clearReconnect(key);
}

/**
 * Cancel the pending timer for `key`, reset its backoff to the base, and
 * invoke its connector now. No-ops if no connector is registered.
 */
export function forceReconnect(key: string): void {
  const entry = entries.get(key);
  if (!entry?.connect) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.delay = BASE_MS;
  entry.connect();
}

/** Force-reconnect every registered key. */
export function forceReconnectAll(): void {
  for (const key of Array.from(entries.keys())) forceReconnect(key);
}
