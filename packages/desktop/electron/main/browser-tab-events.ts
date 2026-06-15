import type { Input, WebContentsView } from "electron";
import { normalizeBrowserOpenUrl } from "./browser-policy";
import { consoleEntry, pushBounded } from "./browser-manager-utils";
import { COMMENT_BADGE_CLICK_SENTINEL } from "./browser-comment-overlay-script";
import type {
  BrowserBounds,
  BrowserConsoleEntry,
  BrowserNetworkEntry,
  BrowserShortcut,
  BrowserTabMetadata,
} from "./browser-types";

const MAX_CONSOLE_PER_TAB = 1000;
const DEFAULT_URL = "about:blank";

export interface ManagedTab {
  metadata: BrowserTabMetadata;
  view: WebContentsView;
  devtoolsView: WebContentsView | null;
  consoleEntries: BrowserConsoleEntry[];
  networkEntries: BrowserNetworkEntry[];
  // Origin approved via the permission-gated browser_open_external_url tool. While
  // the tab stays on this origin it is exempt from the localhost-only automation
  // (mutation) gate; navigating elsewhere re-locks it. null = not unlocked.
  externalAutomationOrigin: string | null;
}

// The slice of BrowserManager that tab-event handlers drive. Passed in so the
// event wiring lives here without the manager exposing its internals.
export interface TabEventHost {
  emitState(): void;
  setLastError(message: string | null): void;
  openChildTab(url: string, profileId: string): void;
  recordOrigin(url: string): void;
  emitShortcut(shortcut: BrowserShortcut): void;
  emitCommentBadgeClick(tabId: string, anchorId: string, box: BrowserBounds | null): void;
}

export function installTabEvents(tab: ManagedTab, host: TabEventHost): void {
  const wc = tab.view.webContents;
  // A focused guest page swallows keydown before the renderer's window
  // listener can see it, so the browser-chrome chords (⌘T new tab, ⌘W close
  // tab) are intercepted here and relayed to the renderer.
  wc.on("before-input-event", (event, input) => {
    const shortcut = guestChrome(input);
    if (!shortcut) return;
    event.preventDefault();
    host.emitShortcut(shortcut);
  });
  // Electron 42 emits a single details object; the old positional (level,
  // message, line, sourceId) args are deprecated and unreliable at runtime.
  wc.on("console-message", (details) => {
    const message = details.message;
    // Comment-badge clicks ride in on a sentinel console line; relay them and
    // never record them as real console output.
    if (message.startsWith(COMMENT_BADGE_CLICK_SENTINEL)) {
      relayBadgeClick(tab.metadata.id, message, host);
      return;
    }
    pushBounded(
      tab.consoleEntries,
      consoleEntry(tab.metadata.id, details.level, message, details.lineNumber, details.sourceId),
      MAX_CONSOLE_PER_TAB,
    );
    host.emitState();
  });
  wc.setWindowOpenHandler(({ url }) => {
    host.openChildTab(url, tab.metadata.sessionProfileId);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    try {
      normalizeBrowserOpenUrl(url);
    } catch (error) {
      event.preventDefault();
      host.setLastError(error instanceof Error ? error.message : String(error));
      host.emitState();
    }
  });
  wc.on("did-start-loading", () => {
    host.setLastError(null);
    // Drop the previous page's favicon up front; page-favicon-updated supplies
    // the new one once the next page declares it (many pages never do).
    updateTabMetadata(tab, { loading: true, faviconUrl: undefined }, host);
  });
  wc.on("did-stop-loading", () => updateTabMetadata(tab, { loading: false }, host));
  wc.on("page-favicon-updated", (_event, favicons) => {
    updateTabMetadata(tab, { faviconUrl: favicons[0] }, host);
  });
  wc.on("did-navigate", () => {
    host.setLastError(null);
    host.recordOrigin(wc.getURL());
    refreshTabMetadata(tab, host);
  });
  wc.on("page-title-updated", () => refreshTabMetadata(tab, host));
  wc.on("did-fail-load", (_event, _code, description, url) => {
    host.setLastError(`${url}: ${description}`);
    host.emitState();
  });
}

// Parse a sentinel badge-click console line (`{ anchorId, box }` JSON) and hand
// it to the host. A malformed payload (should never happen — we emit it) is
// dropped rather than surfaced, since it is an internal transport detail.
function relayBadgeClick(tabId: string, message: string, host: TabEventHost): void {
  try {
    const payload: unknown = JSON.parse(message.slice(COMMENT_BADGE_CLICK_SENTINEL.length));
    if (!payload || typeof payload !== "object") return;
    const { anchorId, box } = payload as { anchorId?: unknown; box?: unknown };
    if (typeof anchorId !== "string") return;
    host.emitCommentBadgeClick(tabId, anchorId, parseBox(box));
  } catch {
    // Unparseable sentinel line — ignore.
  }
}

function parseBox(box: unknown): BrowserBounds | null {
  if (!box || typeof box !== "object") return null;
  const { x, y, width, height } = box as Record<string, unknown>;
  if ([x, y, width, height].some((value) => typeof value !== "number")) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number };
}

// Map a guest-page keydown to a browser-chrome chord, or null. Mirrors the
// renderer registry so the chords still fire while the guest page holds
// keyboard focus (the renderer's window listener never sees those events).
// Exported for unit testing.
export function guestChrome(input: Input): BrowserShortcut | null {
  if (input.type !== "keyDown") return null;
  const mod = process.platform === "darwin" ? input.meta : input.control;
  if (!mod) return null;
  // ⌘⌥I → toggle DevTools (the only combo that uses Alt).
  if (input.alt) return input.key.toLowerCase() === "i" ? "devtools" : null;
  // ⌘+ / ⌘- → zoom the guest page. ⌘+ is really ⌘⇧=, so check before the
  // Shift branch. Matches the produced character, like the renderer registry.
  const zoom = zoomChord(input.key);
  if (zoom) return zoom;
  if (input.shift) return guestShiftChrome(input);
  switch (input.key.toLowerCase()) {
    case "r":
      return "reload";
    case "t":
      return "new-tab";
    case "w":
      return "close-tab";
    case "l":
      return "focus-url";
    case "s":
      return "add-comment";
    default:
      return null;
  }
}

// ⌘+ / ⌘- → zoom. "=" doubles as zoom-in so the unshifted key works too.
function zoomChord(key: string): BrowserShortcut | null {
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-") return "zoom-out";
  return null;
}

// Shift chords: tab switching (⌘⇧[ / ⌘⇧]) and feature-pane switching
// (⌘⇧A/T/G/E/B). Brackets match the physical `code` because Shift mangles
// "[" → "{"; letters stay layout-aware through `key`.
function guestShiftChrome(input: Input): BrowserShortcut | null {
  if (input.code === "BracketLeft") return "prev-tab";
  if (input.code === "BracketRight") return "next-tab";
  switch (input.key.toLowerCase()) {
    case "a":
      return "pane-agent";
    case "t":
      return "pane-terminal";
    case "g":
      return "pane-git";
    case "e":
      return "pane-editor";
    case "b":
      return "pane-browser";
    default:
      return null;
  }
}

function refreshTabMetadata(tab: ManagedTab, host: TabEventHost): void {
  const wc = tab.view.webContents;
  updateTabMetadata(
    tab,
    { title: wc.getTitle() || wc.getURL(), url: wc.getURL() || DEFAULT_URL },
    host,
  );
}

function updateTabMetadata(
  tab: ManagedTab,
  patch: Partial<BrowserTabMetadata>,
  host: TabEventHost,
): void {
  const wc = tab.view.webContents;
  tab.metadata = {
    ...tab.metadata,
    ...patch,
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
  };
  host.emitState();
}
