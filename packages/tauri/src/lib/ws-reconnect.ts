/** Per-key exponential backoff reconnection manager. */

const BASE_MS = 1000;
const MAX_MS = 30000;

interface ReconnectEntry {
  timer: ReturnType<typeof setTimeout> | null;
  delay: number;
}

const entries = new Map<string, ReconnectEntry>();

export function scheduleReconnect(key: string, connect: () => void): void {
  let entry = entries.get(key);
  if (!entry) {
    entry = { timer: null, delay: BASE_MS };
    entries.set(key, entry);
  }
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    const e = entries.get(key);
    if (e) e.timer = null;
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
