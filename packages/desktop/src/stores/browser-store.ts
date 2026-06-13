import { create } from "zustand";
import type { BrowserStateSnapshot } from "@/shared/browser-types";

/**
 * Mirror of the main-process browser snapshot. The browser UI keeps its own
 * local view state, but a few cross-cutting consumers (the ⌘W app-close
 * fallback) need the live tab count outside the browser component tree, so the
 * bootstrap pushes every snapshot here.
 */
interface BrowserStore {
  snapshot: BrowserStateSnapshot | null;
  setSnapshot: (snapshot: BrowserStateSnapshot) => void;
}

export const useBrowserStore = create<BrowserStore>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

/** Number of open browser tabs, read synchronously (0 before the browser opens). */
export function browserTabCount(): number {
  return useBrowserStore.getState().snapshot?.tabs.length ?? 0;
}
