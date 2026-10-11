import { useSyncExternalStore } from "react";

const TICK_MS = 60_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer == null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || timer == null) return;
    clearInterval(timer);
    timer = null;
  };
}

function getNow(): number {
  return now;
}

/**
 * The current time, refreshed once a minute. Every relative timestamp in the
 * sidebar shares this one interval instead of running a timer per row.
 */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}
