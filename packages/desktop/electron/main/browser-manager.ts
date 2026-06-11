import { randomUUID } from "node:crypto";
import { BrowserWindow, WebContentsView, session, type Session } from "electron";
import { normalizeBrowserOpenUrl, redactBrowserHeaders } from "./browser-policy";
import { elementContextScript } from "./browser-element-context-script";
import {
  browserBounds,
  contentOffset,
  devtoolsBounds,
  hiddenBounds,
  scaleBounds,
  windowRelativeBounds,
} from "./browser-manager-layout";
import {
  assertBrowserMutationAllowed,
  consoleEntry,
  isElementPayload,
  isRecord,
  metadataFor,
  profileFromSelection,
  pushBounded,
  secureWebPreferences,
} from "./browser-manager-utils";
import { BrowserNetworkHeadersCache, networkFailureReason } from "./browser-network-headers";
import { BrowserProfileStore } from "./browser-profile-store";
import { browserPartitionForProfile, createBrowserProfile } from "./browser-profiles";
import { captureScreenshotParams } from "./browser-screenshot";
import { sendToWindow } from "./safe-send";
import type {
  BrowserBounds,
  BrowserConsoleEntry,
  BrowserElementContext,
  BrowserNetworkEntry,
  BrowserProfileMetadata,
  BrowserStateSnapshot,
  BrowserTabMetadata,
} from "./browser-types";

const MAX_CONSOLE_PER_TAB = 1000;
const MAX_NETWORK_PER_TAB = 2000;
const DEFAULT_URL = "about:blank";

interface ManagedTab {
  metadata: BrowserTabMetadata;
  view: WebContentsView;
  devtoolsView: WebContentsView | null;
  consoleEntries: BrowserConsoleEntry[];
  networkEntries: BrowserNetworkEntry[];
}

export class BrowserManager {
  private readonly tabs = new Map<string, ManagedTab>();
  private activeTabId: string | null = null;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
  private lastError: string | null = null;
  private readonly instrumentedSessions = new WeakSet<Session>();
  private readonly networkHeaders = new BrowserNetworkHeadersCache();

  constructor(
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly profileStore = new BrowserProfileStore(),
  ) {}

  createTab(rawUrl?: string, profileId = "fresh"): BrowserTabMetadata {
    const id = randomUUID();
    const profile = profileFromSelection(profileId);
    const view = new WebContentsView({ webPreferences: secureWebPreferences(profile) });
    const tab: ManagedTab = {
      metadata: metadataFor(id, profileId),
      view,
      devtoolsView: null,
      consoleEntries: [],
      networkEntries: [],
    };
    this.tabs.set(id, tab);
    this.attachView(id, view);
    this.installTabEvents(tab);
    this.ensureNetworkCollector(view.webContents.session);
    this.activateTab(id);
    if (rawUrl) this.navigate(id, rawUrl);
    this.emitState();
    return tab.metadata;
  }

  listTabs(): BrowserTabMetadata[] {
    return this.state().tabs;
  }

  listProfiles(): BrowserProfileMetadata[] {
    return this.profileStore.list();
  }

  createProfile(profileId: string): BrowserProfileMetadata {
    return this.profileStore.createPersistent(profileId);
  }

  duplicateProfile(sourceId: string, newId: string): BrowserProfileMetadata {
    return this.profileStore.duplicatePersistent(sourceId, newId);
  }

  deleteProfile(profileId: string): void {
    this.profileStore.deletePersistent(profileId);
  }

  async clearStorage(profileId: string): Promise<void> {
    const profile = profileFromSelection(profileId);
    const partition = browserPartitionForProfile(profile);
    const targetSession = session.fromPartition(partition);
    await targetSession.clearStorageData();
    await targetSession.clearCache();
  }

  navigate(tabId: string, rawUrl: string): BrowserTabMetadata {
    const tab = this.requireTab(tabId);
    const url = normalizeBrowserOpenUrl(rawUrl);
    this.lastError = null;
    this.emitState();
    void tab.view.webContents.loadURL(url).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emitState();
    });
    return tab.metadata;
  }

  activateTab(tabId: string): BrowserTabMetadata {
    const tab = this.requireTab(tabId);
    this.activeTabId = tabId;
    for (const [id, item] of this.tabs) {
      item.metadata = { ...item.metadata, isActive: id === tabId };
      item.view.setVisible(id === tabId);
      item.view.setBounds(id === tabId ? this.bounds : hiddenBounds());
      item.devtoolsView?.setVisible(id === tabId && item.metadata.devToolsOpen);
    }
    this.emitState();
    return tab.metadata;
  }

  closeTab(tabId: string): BrowserStateSnapshot {
    const tab = this.requireTab(tabId);
    this.detachView(tab.view);
    if (tab.devtoolsView) this.detachView(tab.devtoolsView);
    tab.view.webContents.close();
    this.tabs.delete(tabId);
    if (this.activeTabId === tabId) this.activeTabId = this.tabs.keys().next().value ?? null;
    if (this.activeTabId) this.activateTab(this.activeTabId);
    this.emitState();
    return this.state();
  }

  setBounds(bounds: BrowserBounds): BrowserStateSnapshot {
    const win = this.getMainWindow();
    const zoomFactor = win?.webContents.getZoomFactor() ?? 1;
    this.bounds = windowRelativeBounds(scaleBounds(bounds, zoomFactor), contentOffset(win));
    for (const [id, tab] of this.tabs) {
      tab.view.setBounds(
        id === this.activeTabId
          ? browserBounds(this.bounds, tab.metadata.devToolsOpen)
          : hiddenBounds(),
      );
      tab.devtoolsView?.setBounds(
        id === this.activeTabId ? devtoolsBounds(this.bounds) : hiddenBounds(),
      );
    }
    return this.state();
  }

  goBack(tabId: string): void {
    const contents = this.requireTab(tabId).view.webContents;
    if (contents.canGoBack()) contents.goBack();
  }

  goForward(tabId: string): void {
    const contents = this.requireTab(tabId).view.webContents;
    if (contents.canGoForward()) contents.goForward();
  }

  reload(tabId: string): void {
    this.requireTab(tabId).view.webContents.reload();
  }

  stop(tabId: string): void {
    this.requireTab(tabId).view.webContents.stop();
  }

  toggleDevTools(tabId: string): BrowserTabMetadata {
    const tab = this.requireTab(tabId);
    if (!tab.devtoolsView) {
      tab.devtoolsView = new WebContentsView({
        webPreferences: secureWebPreferences(createBrowserProfile("fresh")),
      });
      this.attachView(`${tabId}:devtools`, tab.devtoolsView);
      tab.view.webContents.setDevToolsWebContents(tab.devtoolsView.webContents);
    }
    const open = !tab.metadata.devToolsOpen;
    tab.metadata = { ...tab.metadata, devToolsOpen: open };
    tab.devtoolsView.setVisible(open && tab.metadata.isActive);
    tab.devtoolsView.setBounds(open ? devtoolsBounds(this.bounds) : hiddenBounds());
    tab.view.setBounds(browserBounds(this.bounds, open));
    if (open) tab.view.webContents.openDevTools({ mode: "detach" });
    else tab.view.webContents.closeDevTools();
    this.emitState();
    return tab.metadata;
  }

  async snapshot(tabId: string): Promise<unknown> {
    return this.cdp(tabId, "DOMSnapshot.captureSnapshot", { computedStyles: [] });
  }

  async screenshot(
    tabId: string,
    clip?: BrowserElementContext["element"]["boundingBox"],
  ): Promise<string> {
    const result = await this.cdp(tabId, "Page.captureScreenshot", captureScreenshotParams(clip));
    if (isRecord(result) && typeof result.data === "string") return result.data;
    throw new Error("Browser screenshot did not return image data.");
  }

  async click(tabId: string, x: number, y: number): Promise<void> {
    this.assertMutatingAllowed(tabId);
    const wc = this.requireTab(tabId).view.webContents;
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  }

  async typeText(tabId: string, text: string): Promise<void> {
    this.assertMutatingAllowed(tabId);
    this.requireTab(tabId).view.webContents.insertText(text);
  }

  async keypress(tabId: string, keyCode: string): Promise<void> {
    this.assertMutatingAllowed(tabId);
    this.requireTab(tabId).view.webContents.sendInputEvent({ type: "keyDown", keyCode });
  }

  async selectElementContext(tabId: string): Promise<BrowserElementContext> {
    const tab = this.requireTab(tabId);
    const context = await tab.view.webContents.executeJavaScript(elementContextScript(), true);
    if (!isElementPayload(context)) throw new Error("Browser element context capture failed.");
    const screenshotPngBase64 = await this.screenshot(tabId, context.boundingBox);
    return {
      tabId,
      url: tab.metadata.url,
      title: tab.metadata.title,
      capturedAt: new Date().toISOString(),
      screenshotPngBase64,
      element: context,
      diagnostics: this.diagnostics(tab),
    };
  }

  state(): BrowserStateSnapshot {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    return {
      tabs: [...this.tabs.values()].map((tab) => tab.metadata),
      activeTabId: this.activeTabId,
      consoleEntries: active?.consoleEntries ?? [],
      networkEntries: active?.networkEntries ?? [],
      error: this.lastError,
    };
  }

  private installTabEvents(tab: ManagedTab): void {
    const wc = tab.view.webContents;
    wc.on("console-message", (_event, level, message, line, sourceId) => {
      pushBounded(
        tab.consoleEntries,
        consoleEntry(tab.metadata.id, level, message, line, sourceId),
        MAX_CONSOLE_PER_TAB,
      );
      this.emitState();
    });
    wc.setWindowOpenHandler(({ url }) => {
      try {
        this.createTab(url, tab.metadata.sessionProfileId);
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emitState();
      }
      return { action: "deny" };
    });
    wc.on("will-navigate", (event, url) => {
      try {
        normalizeBrowserOpenUrl(url);
      } catch (error) {
        event.preventDefault();
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emitState();
      }
    });
    wc.on("did-start-loading", () => {
      this.lastError = null;
      this.updateMetadata(tab, { loading: true });
    });
    wc.on("did-stop-loading", () => this.updateMetadata(tab, { loading: false }));
    wc.on("did-navigate", () => {
      this.lastError = null;
      this.refreshMetadata(tab);
    });
    wc.on("page-title-updated", () => this.refreshMetadata(tab));
    wc.on("did-fail-load", (_event, _code, description, url) => {
      this.lastError = `${url}: ${description}`;
      this.emitState();
    });
  }

  private ensureNetworkCollector(electronSession: Session): void {
    if (this.instrumentedSessions.has(electronSession)) return;
    this.instrumentedSessions.add(electronSession);
    electronSession.webRequest.onBeforeSendHeaders((details, callback) => {
      this.networkHeaders.remember(details.id, details.requestHeaders);
      callback({ requestHeaders: details.requestHeaders });
    });
    electronSession.webRequest.onCompleted((details) => this.recordNetwork(details));
    electronSession.webRequest.onErrorOccurred((details) => this.recordNetwork(details));
  }

  private recordNetwork(
    details: Electron.OnCompletedListenerDetails | Electron.OnErrorOccurredListenerDetails,
  ): void {
    const tab = [...this.tabs.values()].find(
      (item) => item.view.webContents.id === details.webContentsId,
    );
    if (!tab) return;
    const response = "statusCode" in details ? details : null;
    pushBounded(
      tab.networkEntries,
      {
        id: randomUUID(),
        tabId: tab.metadata.id,
        method: details.method,
        url: details.url,
        status: response?.statusCode,
        requestHeaders: this.networkHeaders.take(details.id),
        responseHeaders: redactBrowserHeaders(response?.responseHeaders ?? {}),
        resourceType: details.resourceType,
        timestamp: new Date().toISOString(),
        failureReason: networkFailureReason(details),
      },
      MAX_NETWORK_PER_TAB,
    );
    this.emitState();
  }

  private async cdp(
    tabId: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const wc = this.requireTab(tabId).view.webContents;
    const dbg = wc.debugger;
    if (!dbg.isAttached()) dbg.attach("1.3");
    return dbg.sendCommand(method, params);
  }

  private assertMutatingAllowed(tabId: string): void {
    const tab = this.requireTab(tabId);
    assertBrowserMutationAllowed(tab.view.webContents.getURL());
  }

  private requireTab(tabId: string): ManagedTab {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`);
    return tab;
  }

  private attachView(_id: string, view: WebContentsView): void {
    this.getMainWindow()?.contentView.addChildView(view);
  }

  private detachView(view: WebContentsView): void {
    this.getMainWindow()?.contentView.removeChildView(view);
  }

  private refreshMetadata(tab: ManagedTab): void {
    const wc = tab.view.webContents;
    this.updateMetadata(tab, {
      title: wc.getTitle() || wc.getURL(),
      url: wc.getURL() || DEFAULT_URL,
    });
  }

  private updateMetadata(tab: ManagedTab, patch: Partial<BrowserTabMetadata>): void {
    const wc = tab.view.webContents;
    tab.metadata = {
      ...tab.metadata,
      ...patch,
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
    };
    this.emitState();
  }

  private diagnostics(tab: ManagedTab): BrowserElementContext["diagnostics"] {
    return {
      consoleErrors: tab.consoleEntries.filter((entry) => entry.level === "error").slice(-20),
      failedNetworkRequests: tab.networkEntries
        .filter((entry) => entry.failureReason || (entry.status ?? 0) >= 400)
        .slice(-20),
    };
  }

  private emitState(): void {
    sendToWindow(this.getMainWindow(), "browser:state", this.state());
  }
}
