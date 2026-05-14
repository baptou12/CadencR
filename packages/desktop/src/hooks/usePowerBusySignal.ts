/**
 * Counts active turns across every WS session and forwards a debounced
 * boolean to the Electron main process. Main ref-counts
 * `powerSaveBlocker('prevent-app-suspension')` off that signal.
 *
 * Provider-neutral: only input is `isTurnActive(lifecycle)`. Never inspects
 * `currentProviderId`.
 */

import { useEffect, useRef } from "react";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { isTurnActive } from "@/stores/ws-turn-lifecycle";
import type { SessionEntry } from "@/stores/ws-session-types";

const DEBOUNCE_MS = 250;

function countActive(sessions: Record<string, SessionEntry>): number {
  let count = 0;
  for (const entry of Object.values(sessions)) {
    if (isTurnActive(entry.lifecycle)) count += 1;
  }
  return count;
}

export function usePowerBusySignal(): void {
  // Start in sync with the "no agents running" default so the very first
  // empty-sessions tick short-circuits before reaching the bridge.
  const lastSentRef = useRef<boolean>(false);
  const lastCountRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!desktopBridge.isElectron) return;

    function flush(busy: boolean): void {
      if (lastSentRef.current === busy) return;
      lastSentRef.current = busy;
      void desktopBridge.setBusy(busy).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`power:set-busy failed: ${message}`);
      });
    }

    function schedule(busy: boolean): void {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flush(busy);
      }, DEBOUNCE_MS);
    }

    // Sync at mount in case sessions are already active (e.g. after HMR).
    const initialCount = countActive(useWsSessionStore.getState().sessions);
    lastCountRef.current = initialCount;
    if (initialCount > 0) schedule(true);

    const unsubscribe = useWsSessionStore.subscribe((state) => {
      const count = countActive(state.sessions);
      // The WS session store mutates on every streamed block (`updateSession`
      // always returns a fresh `sessions` object). Short-circuit on the
      // primitive count so we don't reschedule on every chunk.
      if (count === lastCountRef.current) return;
      const wasBusy = lastCountRef.current > 0;
      const isBusy = count > 0;
      lastCountRef.current = count;
      if (wasBusy !== isBusy) schedule(isBusy);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
      // On unmount (renderer reload during dev), eagerly clear the blocker
      // so HMR doesn't strand a held assertion.
      if (lastSentRef.current === true) {
        void desktopBridge.setBusy(false).catch(() => {
          /* unmount cleanup — already torn down */
        });
        lastSentRef.current = false;
      }
    };
  }, []);
}
