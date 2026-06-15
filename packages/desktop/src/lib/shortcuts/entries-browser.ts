/**
 * Browser-tab shortcut entries. Extracted from `entries.ts` to keep the
 * canonical file under the 400-line limit; merged back into the combined
 * `SHORTCUTS` array exported from `entries.ts`.
 *
 * These mirror real-browser chrome chords. They share combos with the agent
 * tab (⌘T) and the window-close fallback (⌘W) but are scoped to the Browser
 * tab, so the focus gate in `useScopedGlobalShortcut` keeps them from
 * colliding. When the guest page itself has keyboard focus the main process
 * relays the same chords (see `browser-tab-events.ts`).
 */
import type { Shortcut } from "./types";

export const BROWSER_SHORTCUTS = [
  {
    id: "browser-new-tab",
    keys: ["mod", "t"],
    description: "New browser tab",
    scope: "browser",
  },
  {
    id: "browser-close",
    keys: ["mod", "w"],
    description: "Close browser tab",
    scope: "browser",
  },
  {
    id: "browser-prev-tab",
    keys: ["mod", "shift", "lbracket"],
    description: "Previous browser tab",
    scope: "browser",
  },
  {
    id: "browser-next-tab",
    keys: ["mod", "shift", "rbracket"],
    description: "Next browser tab",
    scope: "browser",
  },
  {
    id: "browser-focus-url",
    keys: ["mod", "l"],
    description: "Focus the address bar",
    scope: "browser",
  },
  {
    id: "browser-reload",
    keys: ["mod", "r"],
    description: "Reload the page",
    scope: "browser",
  },
  {
    id: "browser-add-comment",
    keys: ["mod", "s"],
    description: "Add a page comment",
    scope: "browser",
  },
  {
    // ⌘⌥I matches Chrome/Electron's DevTools chord. In dev the Electron menu
    // accelerator intercepts it before the page sees it, so this binding only
    // takes effect in packaged builds — acceptable, the toolbar button covers dev.
    id: "browser-devtools",
    keys: ["mod", "alt", "i"],
    description: "Toggle browser DevTools",
    scope: "browser",
  },
] as const satisfies readonly Shortcut[];
