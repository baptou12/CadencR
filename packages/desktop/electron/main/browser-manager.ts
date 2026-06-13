import { randomUUID } from "node:crypto";
import { BrowserWindow, WebContentsView, session } from "electron";
import { normalizeBrowserOpenUrl } from "./browser-policy";
import {
  captureDomOutline,
  captureDomSnapshot,
  captureElementContext,
  capturePageImage,
  captureRegionScreenshot,
  evaluateInPage,
  type BrowserDomOutline,
  type BrowserDomSnapshot,
  type BrowserEvalResult,
} from "./browser-dom";
import {
  addCommentBadgeScript,
  clearCommentBadgesScript,
  removeCommentBadgeScript,
} from "./browser-comment-overlay-script";
import {
  clickTarget as clickTargetOnPage,
  fillTarget as fillTargetOnPage,
  hoverTarget as hoverTargetOnPage,
  resolveTarget,
  waitFor as waitForOnPage,
  waitForLoad,
  type BrowserTarget,
  type BrowserWaitResult,
  type ResolvedTarget,
} from "./browser-interactions";
import { BrowserNetworkCollector } from "./browser-network-collector";
import { BrowserOriginStore } from "./browser-origin-store";
import { installTabEvents, type ManagedTab } from "./browser-tab-events";
import { contentOffset, scaleBounds, windowRelativeBounds } from "./browser-manager-layout";
import { BrowserViewLayout } from "./browser-view-layout";
import {
  assertBrowserMutationAllowed,
  metadataFor,
  profileFromSelection,
  pushBounded,
  secureWebPreferences,
  tabDiagnostics,
} from "./browser-manager-utils";
import { BrowserProfileStore } from "./browser-profile-store";
import { browserPartitionForProfile, createBrowserProfile } from "./browser-profiles";
import { sendToWindow } from "./safe-send";
import type {
  BrowserBounds,
  BrowserElementContext,
  BrowserProfileMetadata,
  BrowserShortcut,
  BrowserStateSnapshot,
  BrowserTabMetadata,
} from "./browser-types";

const MAX_NETWORK_PER_TAB = 2000;

export class BrowserManager {
  private readonly tabs = new Map<string, ManagedTab>();
  private activeTabId: string | null = null;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
  private lastError: string | null = null;
  // Native-view attachment + geometry (incl. overlay suppression) lives here.
  private readonly layout = new BrowserViewLayout(() => this.getMainWindow());
  private readonly origins = new BrowserOriginStore();
  private readonly network = new BrowserNetworkCollector((webContentsId, entry) => {
    const tab = [...this.tabs.values()].find((t) => t.view.webContents.id === webContentsId);
    if (!tab) return;
    pushBounded(tab.networkEntries, { ...entry, tabId: tab.metadata.id }, MAX_NETWORK_PER_TAB);
    this.emitState();
  });

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
    installTabEvents(tab, {
      emitState: () => this.emitState(),
      setLastError: (message) => {
        this.lastError = message;
      },
      openChildTab: (url, profileId) => this.openChildTab(url, profileId),
      recordOrigin: (url) => this.origins.record(url),
      emitShortcut: (shortcut) => this.emitShortcut(shortcut),
      emitCommentBadgeClick: (id, anchorId, box) =>
        sendToWindow(this.getMainWindow(), "browser:comment-badge-click", {
          tabId: id,
          anchorId,
          box,
        }),
    });
    this.network.ensure(view.webContents.session);
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
    }
    this.applyLayout();
    this.emitState();
    return tab.metadata;
  }

  /**
   * Hide (or restore) every native view. Called when a renderer overlay opens
   * so React dialogs/popovers aren't painted under the always-on-top guest
   * page. Idempotent.
   */
  setSuppressed(value: boolean): void {
    if (this.layout.setSuppressed(value)) this.applyLayout();
  }

  private applyLayout(): void {
    this.layout.apply(this.tabs, this.activeTabId, this.bounds);
  }

  closeTab(tabId: string): BrowserStateSnapshot {
    const tab = this.requireTab(tabId);
    this.layout.detach(tab.view);
    if (tab.devtoolsView) this.layout.detach(tab.devtoolsView);
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
    this.applyLayout();
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
      tab.view.webContents.setDevToolsWebContents(tab.devtoolsView.webContents);
    }
    const open = !tab.metadata.devToolsOpen;
    tab.metadata = { ...tab.metadata, devToolsOpen: open };
    this.applyLayout();
    if (open) tab.view.webContents.openDevTools({ mode: "detach" });
    else tab.view.webContents.closeDevTools();
    this.emitState();
    return tab.metadata;
  }

  async openUrl(url: string, tabId?: string): Promise<BrowserTabMetadata> {
    const meta = tabId ? this.navigate(tabId, url) : this.createTab(url);
    await waitForLoad(this.requireTab(meta.id).view.webContents);
    return this.requireTab(meta.id).metadata;
  }

  async snapshot(
    tabId: string,
    selector?: string,
    maxLength?: number,
    format?: string,
  ): Promise<BrowserDomSnapshot | BrowserDomOutline> {
    const wc = this.requireTab(tabId).view.webContents;
    return format === "html"
      ? captureDomSnapshot(wc, selector, maxLength)
      : captureDomOutline(wc, selector, maxLength);
  }

  async screenshot(tabId: string, clip?: BrowserBounds): Promise<string> {
    const wc = this.requireTab(tabId).view.webContents;
    return clip ? captureRegionScreenshot(wc, clip) : capturePageImage(wc);
  }

  async screenshotTarget(tabId: string, target: BrowserTarget): Promise<string> {
    const wc = this.requireTab(tabId).view.webContents;
    const { boundingBox } = await resolveTarget(wc, target);
    return captureRegionScreenshot(wc, boundingBox);
  }

  async evaluate(tabId: string, script: string): Promise<BrowserEvalResult> {
    this.assertMutatingAllowed(tabId);
    return evaluateInPage(this.requireTab(tabId).view.webContents, script);
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

  async clickTarget(tabId: string, target: BrowserTarget): Promise<ResolvedTarget> {
    this.assertMutatingAllowed(tabId);
    return clickTargetOnPage(this.requireTab(tabId).view.webContents, target);
  }

  async hover(tabId: string, target: BrowserTarget): Promise<ResolvedTarget> {
    this.assertMutatingAllowed(tabId);
    return hoverTargetOnPage(this.requireTab(tabId).view.webContents, target);
  }

  async fill(tabId: string, target: BrowserTarget, value: string): Promise<void> {
    this.assertMutatingAllowed(tabId);
    return fillTargetOnPage(this.requireTab(tabId).view.webContents, target, value);
  }

  async waitFor(
    tabId: string,
    opts: { selector?: string; text?: string },
    timeoutMs?: number,
  ): Promise<BrowserWaitResult> {
    return waitForOnPage(this.requireTab(tabId).view.webContents, opts, timeoutMs);
  }

  async selectElementContext(tabId: string, anchorId?: string): Promise<BrowserElementContext> {
    const tab = this.requireTab(tabId);
    const context = await captureElementContext(
      tab.view.webContents,
      {
        tabId,
        url: tab.metadata.url,
        title: tab.metadata.title,
        capturedAt: new Date().toISOString(),
      },
      tabDiagnostics(tab.consoleEntries, tab.networkEntries),
      anchorId ?? null,
    );
    // Pin a numbered badge to the element the user just picked. The agent/MCP
    // path passes no anchor and gets context without a badge.
    if (anchorId) {
      await tab.view.webContents.executeJavaScript(addCommentBadgeScript(anchorId), true);
    }
    return context;
  }

  async removeCommentBadge(tabId: string, anchorId: string): Promise<void> {
    await this.requireTab(tabId).view.webContents.executeJavaScript(
      removeCommentBadgeScript(anchorId),
      true,
    );
  }

  async clearCommentBadges(tabId: string): Promise<void> {
    await this.requireTab(tabId).view.webContents.executeJavaScript(
      clearCommentBadgesScript(),
      true,
    );
  }

  state(): BrowserStateSnapshot {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    return {
      tabs: [...this.tabs.values()].map((tab) => tab.metadata),
      activeTabId: this.activeTabId,
      consoleEntries: active?.consoleEntries ?? [],
      networkEntries: active?.networkEntries ?? [],
      knownOrigins: this.origins.list(),
      error: this.lastError,
    };
  }

  private openChildTab(url: string, profileId: string): void {
    try {
      this.createTab(url, profileId);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emitState();
    }
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

  private emitState(): void {
    sendToWindow(this.getMainWindow(), "browser:state", this.state());
  }

  private emitShortcut(shortcut: BrowserShortcut): void {
    sendToWindow(this.getMainWindow(), "browser:shortcut", shortcut);
  }
}
