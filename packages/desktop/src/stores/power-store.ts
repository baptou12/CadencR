/**
 * Tiny renderer-side store mirroring the OS power state (suspended / not).
 *
 * Set by `usePowerEvents` from Electron's `powerMonitor` events. Read by
 * `SuspendedBanner` to render the global "system asleep" indicator.
 *
 * Exception to `no-optimistic-updates.md`: this reflects an OS-confirmed
 * event, not a guess about backend state. Per-session lifecycle remains
 * backend-confirmed via `session.lifecycle` envelopes.
 */

import { create } from "zustand";

interface PowerStoreState {
  suspended: boolean;
  setSuspended: (value: boolean) => void;
}

export const usePowerStore = create<PowerStoreState>((set) => ({
  suspended: false,
  setSuspended: (value: boolean) => set({ suspended: value }),
}));
