export interface BrowserProfileMetadata {
  id: string;
  label: string;
  mode: "fresh" | "feature" | "persistent";
}

export interface BrowserTabMetadata {
  id: string;
  title: string;
  url: string;
  faviconUrl?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  sessionProfileId: string;
  isActive: boolean;
  devToolsOpen: boolean;
}

export interface BrowserConsoleEntry {
  id: string;
  tabId: string;
  level: string;
  message: string;
  sourceUrl: string;
  lineNumber: number;
  timestamp: string;
}

export interface BrowserNetworkEntry {
  id: string;
  tabId: string;
  method: string;
  url: string;
  status?: number;
  requestHeaders: Record<string, string | string[] | undefined>;
  responseHeaders: Record<string, string | string[] | undefined>;
  resourceType?: string;
  timestamp: string;
  failureReason?: string;
}

export interface BrowserStateSnapshot {
  tabs: BrowserTabMetadata[];
  activeTabId: string | null;
  consoleEntries: BrowserConsoleEntry[];
  networkEntries: BrowserNetworkEntry[];
  /**
   * Origins the user has previously navigated to (e.g. `http://localhost:1420`,
   * `https://example.com`), ranked most-pertinent first. Feeds the address-bar
   * autocomplete so previously opened sites can be reopened with a few keys.
   */
  knownOrigins: string[];
  error: string | null;
}

/**
 * Browser-chrome chords forwarded from a focused guest page (a native
 * `WebContentsView` swallows keydown before the renderer can see it, so the
 * main process intercepts these via `before-input-event` and relays them).
 */
export type BrowserShortcut =
  | "new-tab"
  | "close-tab"
  | "prev-tab"
  | "next-tab"
  | "focus-url"
  | "add-comment"
  | "devtools";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A user click on an on-page comment badge, relayed from the guest page so the
 * renderer can reopen that comment's composer. `box` is the anchored element's
 * current viewport rect (used to position the form), or null if it's gone.
 */
export interface BrowserCommentBadgeClick {
  tabId: string;
  anchorId: string;
  box: BrowserBounds | null;
}

export interface BrowserElementContext {
  tabId: string;
  url: string;
  title: string;
  capturedAt: string;
  screenshotPngBase64: string;
  element: {
    selectorCandidates: string[];
    tagName: string;
    id?: string;
    className?: string;
    textPreview?: string;
    attributes: Record<string, string>;
    boundingBox: { x: number; y: number; width: number; height: number };
    computedStyles: Record<string, string>;
    accessibility?: { role?: string; name?: string };
  };
  diagnostics: {
    consoleErrors: BrowserConsoleEntry[];
    failedNetworkRequests: BrowserNetworkEntry[];
  };
}
