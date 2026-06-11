import type { WebContentsView } from "electron";
import { normalizeBrowserOpenUrl } from "./browser-policy";
import { consoleEntry, pushBounded } from "./browser-manager-utils";
import type { BrowserConsoleEntry, BrowserNetworkEntry, BrowserTabMetadata } from "./browser-types";

const MAX_CONSOLE_PER_TAB = 1000;
const DEFAULT_URL = "about:blank";

export interface ManagedTab {
  metadata: BrowserTabMetadata;
  view: WebContentsView;
  devtoolsView: WebContentsView | null;
  consoleEntries: BrowserConsoleEntry[];
  networkEntries: BrowserNetworkEntry[];
}

// The slice of BrowserManager that tab-event handlers drive. Passed in so the
// event wiring lives here without the manager exposing its internals.
export interface TabEventHost {
  emitState(): void;
  setLastError(message: string | null): void;
  openChildTab(url: string, profileId: string): void;
}

export function installTabEvents(tab: ManagedTab, host: TabEventHost): void {
  const wc = tab.view.webContents;
  wc.on("console-message", (_event, level, message, line, sourceId) => {
    pushBounded(
      tab.consoleEntries,
      consoleEntry(tab.metadata.id, level, message, line, sourceId),
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
    updateTabMetadata(tab, { loading: true }, host);
  });
  wc.on("did-stop-loading", () => updateTabMetadata(tab, { loading: false }, host));
  wc.on("did-navigate", () => {
    host.setLastError(null);
    refreshTabMetadata(tab, host);
  });
  wc.on("page-title-updated", () => refreshTabMetadata(tab, host));
  wc.on("did-fail-load", (_event, _code, description, url) => {
    host.setLastError(`${url}: ${description}`);
    host.emitState();
  });
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
