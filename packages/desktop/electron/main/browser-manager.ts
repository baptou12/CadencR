import { BrowserWindow } from "electron";
import { normalizeBrowserOpenUrl } from "./browser-policy";
import type { BrowserDomOutline, BrowserDomSnapshot, BrowserEvalResult } from "./browser-dom";
import {
  clearCommentBadges,
  removeCommentBadge,
  selectElementContext,
} from "./browser-comment-context";
import { BrowserFocusGuard } from "./browser-focus-guard";
import { BrowserLibraryController } from "./browser-library-controller";
import { BrowserLibraryStore } from "./browser-library-store";
import { BrowserAutomationAuthority } from "./browser-automation-authority";
import { toggleTabDevTools } from "./browser-devtools";
import {
  clickPage,
  clickTargetPage,
  evaluatePage,
  fillPage,
  hoverPage,
  keypressPage,
  screenshotPage,
  screenshotTargetPage,
  snapshotPage,
  typeTextPage,
  waitForPage,
} from "./browser-page-actions";
import {
  waitForLoad,
  type BrowserTarget,
  type BrowserWaitResult,
  type ResolvedTarget,
} from "./browser-interactions";
import { BrowserNetworkCollector } from "./browser-network-collector";
import { BrowserOriginStore } from "./browser-origin-store";
import { BrowserPageController } from "./browser-page-controller";
import { installTabEvents, type ManagedTab } from "./browser-tab-events";
import { BrowserTabCloseController } from "./browser-tab-close-controller";
import { BrowserTabLifecycle } from "./browser-tab-lifecycle";
import { isPrivateProfile } from "./browser-session-lifecycle";
import { BrowserScopeState } from "./browser-scope-state";
import { BrowserSiteApi } from "./browser-site-api";
import { BrowserSiteController } from "./browser-site-controller";
import { contentOffset, scaleBounds, windowRelativeBounds } from "./browser-manager-layout";
import { BrowserViewLayout } from "./browser-view-layout";
import {
  originOf,
  profileFromSelection,
  pushBounded,
  reclaimFocusForShortcut,
} from "./browser-manager-utils";
import type { BrowserProfile } from "./browser-profiles";
import { sendToWindow } from "./safe-send";
import {
  MAX_NETWORK_PER_TAB,
  countTabsByScope,
  tabCountRecordsEqual,
} from "./browser-manager-tabs";
import type {
  BrowserBounds,
  BrowserAgentAccess,
  BrowserElementContext,
  BrowserOpenUrlOptions,
  BrowserShortcut,
  BrowserStateSnapshot,
  BrowserTabMetadata,
} from "./browser-types";

export class BrowserManager {
  private readonly tabs = new Map<string, ManagedTab>();
  private lastTabCountsByScope: Record<number, number> = {};
  private readonly scopes = new BrowserScopeState();
  private lastError: string | null = null;
  readonly focusGuard = new BrowserFocusGuard(() => this.getMainWindow());
  private readonly layout = new BrowserViewLayout(() => this.getMainWindow());
  private readonly tabLifecycle = new BrowserTabLifecycle(this.tabs, this.layout);
  private readonly tabCloser = new BrowserTabCloseController(
    this.tabs,
    this.scopes,
    this.tabLifecycle,
    {
      emitCounts: () => this.emitTabCountsIfChanged(),
      activate: (tabId) => this.activateTab(tabId),
      applyLayout: () => this.applyLayout(),
      emitState: (scope) => this.emitState(scope),
      reportError: (error, scope) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emitState(scope);
      },
      invalidateFind: (tab) => this.page.invalidateFind(tab),
    },
  );
  private readonly origins = new BrowserOriginStore();
  readonly library = new BrowserLibraryController(
    new BrowserLibraryStore(undefined, undefined, (change) =>
      sendToWindow(this.getMainWindow(), "browser:library-changed", change),
    ),
    this.origins,
    (tabId) => this.requireTab(tabId),
    (message, scopeId) => {
      this.lastError = message;
      this.emitState(scopeId);
    },
  );
  private readonly network = new BrowserNetworkCollector((webContentsId, entry) => {
    const tab = [...this.tabs.values()].find((t) => t.webContents.id === webContentsId);
    if (!tab) return;
    pushBounded(tab.networkEntries, { ...entry, tabId: tab.metadata.id }, MAX_NETWORK_PER_TAB);
    this.emitState(tab.metadata.scopeId);
  });
  private readonly siteController = new BrowserSiteController({
    send: (channel, payload) => sendToWindow(this.getMainWindow(), channel, payload),
    reportError: (message) => {
      this.lastError = message;
    },
  });
  readonly site = new BrowserSiteApi(this.siteController, (tabId) => this.requireTab(tabId));
  readonly automation = new BrowserAutomationAuthority(this.tabs, (scopeId) => this.state(scopeId));
  readonly page = new BrowserPageController(
    this.tabs,
    (tabId) => this.requireTab(tabId),
    (scopeId) => this.emitState(scopeId),
    (result) => sendToWindow(this.getMainWindow(), "browser:find-result", result),
  );

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  createTab(
    rawUrl?: string,
    profileId = "fresh",
    scopeId: number | null = null,
  ): BrowserTabMetadata {
    const profile = profileFromSelection(profileId);
    return this.createTabInProfile(rawUrl, profileId, profile, scopeId);
  }

  private createTabInProfile(
    rawUrl: string | undefined,
    selectionId: string,
    profile: BrowserProfile,
    scopeId: number | null,
    automationAccess: BrowserAgentAccess = "user",
  ): BrowserTabMetadata {
    const tab = this.tabLifecycle.create(selectionId, profile, scopeId, automationAccess);
    const id = tab.metadata.id;
    try {
      installTabEvents(tab, {
        emitState: () => this.emitState(scopeId),
        setLastError: (message) => {
          this.lastError = message;
        },
        openChildTab: (url) => this.openChildTab(url, tab),
        isTabAlive: () => this.tabs.has(id),
        tabDestroyed: () => this.tabCloser.handleNativeDestroyed(tab),
        recordOrigin: isPrivateProfile(profile)
          ? () => undefined
          : (url) => this.origins.record(url),
        recordHistoryNavigation: (url, title) => this.library.recordNavigation(tab, url, title),
        updateHistoryTitle: (url, title) => this.library.updateTitle(tab, url, title),
        forgetHistory: () => this.library.forget(id),
        emitShortcut: (shortcut) => this.emitShortcut(shortcut),
        matchGuestShortcut: (input) => this.page.matchGuestShortcut(input),
        emitFindResult: (result) => this.page.handleFindResult(tab, result),
        invalidateFind: () => this.page.invalidateFind(tab),
        syncZoom: () => this.page.syncZoom(),
        emitCommentBadgeClick: (id, anchorId, box) =>
          sendToWindow(this.getMainWindow(), "browser:comment-badge-click", {
            tabId: id,
            anchorId,
            box,
          }),
      });
      this.network.ensure(tab.webContents.session);
      this.focusGuard.watch(tab.webContents);
      this.tabLifecycle.register(tab);
      this.siteController.registerTab(tab);
      this.emitTabCountsIfChanged();
      this.activateTab(id);
      if (rawUrl) this.navigate(id, rawUrl);
      this.emitState(scopeId);
      return tab.metadata;
    } catch (error) {
      this.tabCloser.discardFailed(tab, error);
      throw error;
    }
  }

  tabCountsByScope(): Record<number, number> {
    return countTabsByScope(this.tabs.values());
  }

  navigate(tabId: string, rawUrl: string): BrowserTabMetadata {
    const tab = this.requireTab(tabId);
    const url = normalizeBrowserOpenUrl(rawUrl);
    this.lastError = null;
    this.page.invalidateFind(tab);
    this.emitState(tab.metadata.scopeId);
    void tab.webContents.loadURL(url).catch((error: unknown) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emitState(tab.metadata.scopeId);
    });
    return tab.metadata;
  }

  activateTab(tabId: string): BrowserTabMetadata {
    const tab = this.requireTab(tabId);
    this.scopes.activate(tab.metadata.scopeId, tabId);
    this.scopes.refreshActiveFlags(this.tabs);
    this.applyLayout();
    this.emitState(tab.metadata.scopeId);
    return tab.metadata;
  }

  setSuppressed(value: boolean): void {
    if (this.layout.setSuppressed(value)) this.applyLayout();
  }

  private applyLayout(): void {
    this.layout.apply(this.tabs, this.scopes.active, this.scopes.bounds);
  }

  async closeTab(tabId: string): Promise<BrowserStateSnapshot> {
    const tab = this.requireTab(tabId);
    const scope = tab.metadata.scopeId;
    await this.tabCloser.close(tab);
    return this.state(scope);
  }

  async closeTabsForScope(scopeId: number): Promise<BrowserStateSnapshot> {
    await this.tabCloser.closeScope(scopeId);
    return this.state(scopeId);
  }

  setBounds(
    bounds: BrowserBounds,
    scopeId: number | null = null,
    zoomFactor?: number,
  ): BrowserStateSnapshot {
    const win = this.getMainWindow();
    const factor = zoomFactor ?? win?.webContents.getZoomFactor() ?? 1;
    this.scopes.setBounds(
      scopeId,
      windowRelativeBounds(scaleBounds(bounds, factor), contentOffset(win)),
    );
    this.applyLayout();
    return this.state(scopeId);
  }

  toggleDevTools(tabId: string): BrowserTabMetadata {
    const tab = this.requireTab(tabId);
    return toggleTabDevTools(
      tab,
      () => this.applyLayout(),
      () => this.emitState(tab.metadata.scopeId),
    );
  }

  async openUrl(url: string, options: BrowserOpenUrlOptions = {}): Promise<BrowserTabMetadata> {
    const scopeId = options.scopeId ?? null;
    const activeTabId = options.newTab === true ? null : this.scopes.activeTabId(scopeId);
    const targetTabId = options.tabId ?? activeTabId;
    if (targetTabId) this.automation.assert(targetTabId, scopeId);
    const meta = targetTabId
      ? this.navigate(targetTabId, url)
      : this.createTabInProfile(url, "fresh", profileFromSelection("fresh"), scopeId, "agent");
    await waitForLoad(this.requireTab(meta.id).webContents);
    this.automation.assert(meta.id, scopeId);
    return this.requireTab(meta.id).metadata;
  }

  async openExternalUrl(
    url: string,
    options: BrowserOpenUrlOptions = {},
  ): Promise<BrowserTabMetadata> {
    const meta = await this.openUrl(url, options);
    const tab = this.requireTab(meta.id);
    this.automation.assert(meta.id, options.scopeId ?? null);
    tab.externalAutomationOrigin = originOf(tab.webContents.getURL());
    return tab.metadata;
  }

  async snapshot(
    tabId: string,
    selector?: string,
    maxLength?: number,
    format?: string,
  ): Promise<BrowserDomSnapshot | BrowserDomOutline> {
    return snapshotPage(this.requireTab(tabId), selector, maxLength, format);
  }

  async screenshot(tabId: string, clip?: BrowserBounds): Promise<string> {
    return screenshotPage(this.requireTab(tabId), clip);
  }

  async screenshotTarget(
    tabId: string,
    target: BrowserTarget,
    authorize?: () => void,
  ): Promise<string> {
    return screenshotTargetPage(this.requireTab(tabId), target, authorize);
  }

  async evaluate(tabId: string, script: string): Promise<BrowserEvalResult> {
    return evaluatePage(this.requireTab(tabId), script);
  }

  async click(tabId: string, x: number, y: number): Promise<void> {
    clickPage(this.requireTab(tabId), x, y);
  }

  async typeText(tabId: string, text: string): Promise<void> {
    typeTextPage(this.requireTab(tabId), text);
  }

  async keypress(tabId: string, keyCode: string): Promise<void> {
    keypressPage(this.requireTab(tabId), keyCode);
  }

  async clickTarget(
    tabId: string,
    target: BrowserTarget,
    authorize?: () => void,
  ): Promise<ResolvedTarget> {
    return clickTargetPage(this.requireTab(tabId), target, authorize);
  }

  async hover(
    tabId: string,
    target: BrowserTarget,
    authorize?: () => void,
  ): Promise<ResolvedTarget> {
    return hoverPage(this.requireTab(tabId), target, authorize);
  }

  async fill(tabId: string, target: BrowserTarget, value: string): Promise<void> {
    return fillPage(this.requireTab(tabId), target, value);
  }

  async waitFor(
    tabId: string,
    opts: { selector?: string; text?: string },
    timeoutMs?: number,
  ): Promise<BrowserWaitResult> {
    return waitForPage(this.requireTab(tabId), opts, timeoutMs);
  }

  selectElementContext(tabId: string, anchorId?: string): Promise<BrowserElementContext> {
    return selectElementContext(this.requireTab(tabId), anchorId);
  }

  removeCommentBadge(tabId: string, anchorId: string): Promise<void> {
    return removeCommentBadge(this.requireTab(tabId), anchorId);
  }

  clearCommentBadges(tabId: string): Promise<void> {
    return clearCommentBadges(this.requireTab(tabId));
  }

  state(scopeId?: number | null): BrowserStateSnapshot {
    return this.scopes.snapshot(scopeId, this.tabs, this.origins.list(), this.lastError);
  }

  private openChildTab(url: string, parent: ManagedTab): void {
    try {
      this.createTabInProfile(
        url,
        parent.metadata.sessionProfileId,
        parent.profile,
        parent.metadata.scopeId,
        parent.automationAccess,
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.emitState(parent.metadata.scopeId);
    }
  }

  private requireTab(tabId: string): ManagedTab {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`);
    return tab;
  }

  private emitState(scope: number | null): void {
    const win = this.getMainWindow();
    if (scope === null) return;
    sendToWindow(win, "browser:state", this.state(scope));
  }

  private emitTabCountsIfChanged(): void {
    const counts = this.tabCountsByScope();
    if (tabCountRecordsEqual(this.lastTabCountsByScope, counts)) return;
    this.lastTabCountsByScope = counts;
    sendToWindow(this.getMainWindow(), "browser:tab-counts", counts);
  }

  private emitShortcut(shortcut: BrowserShortcut): void {
    const win = this.getMainWindow();
    reclaimFocusForShortcut(win, shortcut);
    sendToWindow(win, "browser:shortcut", shortcut);
  }
}
