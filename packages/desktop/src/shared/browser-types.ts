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
  error: string | null;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
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
