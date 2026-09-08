import type { BrowserWindow } from "electron";
import { normalizeBrowserOpenUrl } from "./browser-policy";
import type { BrowserFocusGuard } from "./browser-focus-guard";
import type { BrowserLibraryController } from "./browser-library-controller";
import type { BrowserNetworkCollector } from "./browser-network-collector";
import type { BrowserOriginStore } from "./browser-origin-store";
import type { BrowserPageController } from "./browser-page-controller";
import type { BrowserProfile } from "./browser-profiles";
import { isPrivateProfile } from "./browser-session-lifecycle";
import type { BrowserSiteController } from "./browser-site-controller";
import type { BrowserTabCloseController } from "./browser-tab-close-controller";
import { installTabEvents, type ManagedTab } from "./browser-tab-events";
import type { BrowserTabLifecycle } from "./browser-tab-lifecycle";
import type { BrowserTabWorkspaceController } from "./browser-tab-workspace-controller";
import type { BrowserAgentAccess, BrowserShortcut, BrowserTabMetadata } from "./browser-types";
import { sendToWindow } from "./safe-send";

interface BrowserTabCreationHost {
  getWindow(): BrowserWindow | null;
  setLastError(message: string | null): void;
  emitState(scopeId: number | null): void;
  emitCounts(): void;
  emitShortcut(shortcut: BrowserShortcut): void;
  activate(tabId: string): BrowserTabMetadata;
  navigate(tabId: string, url: string): BrowserTabMetadata;
  persist(scopeId: number | null): void;
  handleNativeDestroyed(tab: ManagedTab): void;
}

interface BrowserTabCreationOptions {
  tabs: Map<string, ManagedTab>;
  workspace: BrowserTabWorkspaceController;
  lifecycle: BrowserTabLifecycle;
  closer: BrowserTabCloseController;
  network: BrowserNetworkCollector;
  focusGuard: BrowserFocusGuard;
  site: BrowserSiteController;
  origins: BrowserOriginStore;
  library: BrowserLibraryController;
  page: BrowserPageController;
  host: BrowserTabCreationHost;
}

/** Creates and wires live tabs, including lazy-restored and child tabs. */
export class BrowserTabCreationController {
  constructor(private readonly options: BrowserTabCreationOptions) {}

  create(
    rawUrl: string | undefined,
    selectionId: string,
    profile: BrowserProfile,
    scopeId: number | null,
    automationAccess: BrowserAgentAccess = "user",
    restoredMetadata?: BrowserTabMetadata,
    reuseOrder = false,
  ): BrowserTabMetadata {
    const { tabs, workspace, lifecycle, host } = this.options;
    const normalizedUrl = rawUrl ? normalizeBrowserOpenUrl(rawUrl) : undefined;
    if (!reuseOrder) workspace.assertCanCreate(scopeId, profile.mode, automationAccess, tabs);
    const tab = lifecycle.create(selectionId, profile, scopeId, automationAccess, restoredMetadata);
    try {
      this.installEvents(tab, profile);
      this.options.network.ensure(tab.webContents.session);
      this.options.focusGuard.watch(tab.webContents);
      lifecycle.register(tab);
      this.options.site.registerTab(tab);
      workspace.register(tab, reuseOrder);
      host.emitCounts();
      host.activate(tab.metadata.id);
      if (normalizedUrl) host.navigate(tab.metadata.id, normalizedUrl);
      host.emitState(scopeId);
      if (profile.mode === "persistent" && automationAccess !== "agent") host.persist(scopeId);
      return tab.metadata;
    } catch (error) {
      workspace.rollbackRegistration(tab, reuseOrder);
      this.options.closer.discardFailed(tab, error);
      throw error;
    }
  }

  private installEvents(tab: ManagedTab, profile: BrowserProfile): void {
    const { tabs, host, origins, library, page } = this.options;
    const id = tab.metadata.id;
    installTabEvents(tab, {
      emitState: () => host.emitState(tab.metadata.scopeId),
      setLastError: (message) => host.setLastError(message),
      openChildTab: (url) => this.openChildTab(url, tab),
      isTabAlive: () => tabs.has(id),
      tabDestroyed: () => host.handleNativeDestroyed(tab),
      recordOrigin: isPrivateProfile(profile) ? () => undefined : (url) => origins.record(url),
      recordHistoryNavigation: (url, title) => library.recordNavigation(tab, url, title),
      updateHistoryTitle: (url, title) => library.updateTitle(tab, url, title),
      forgetHistory: () => library.forget(id),
      emitShortcut: host.emitShortcut,
      matchGuestShortcut: (input) => page.matchGuestShortcut(input),
      emitFindResult: (result) => page.handleFindResult(tab, result),
      invalidateFind: () => page.invalidateFind(tab),
      syncZoom: () => page.syncZoom(),
      persistTab: () => host.persist(tab.metadata.scopeId),
      emitCommentBadgeClick: (tabId, anchorId, box) =>
        sendToWindow(host.getWindow(), "browser:comment-badge-click", { tabId, anchorId, box }),
    });
  }

  private openChildTab(url: string, parent: ManagedTab): void {
    try {
      this.create(
        url,
        parent.metadata.sessionProfileId,
        parent.profile,
        parent.metadata.scopeId,
        parent.automationAccess,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.host.setLastError(message);
      this.options.host.emitState(parent.metadata.scopeId);
    }
  }
}
