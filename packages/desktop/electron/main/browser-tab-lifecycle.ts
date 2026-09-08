import { randomUUID } from "node:crypto";
import { WebContentsView, type WebContents } from "electron";
import { metadataFor, secureWebPreferences } from "./browser-manager-utils";
import type { BrowserViewLayout } from "./browser-view-layout";
import type { BrowserProfile } from "./browser-profiles";
import { BrowserSessionLifecycle } from "./browser-session-lifecycle";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserAgentAccess } from "./browser-types";
import type { BrowserTabMetadata } from "./browser-types";

/** Constructs and destroys tabs while keeping private-session ownership exact. */
export class BrowserTabLifecycle {
  private readonly sessions = new BrowserSessionLifecycle();
  private readonly destructions = new WeakMap<ManagedTab, Promise<void>>();

  constructor(
    private readonly tabs: Map<string, ManagedTab>,
    private readonly layout: BrowserViewLayout,
  ) {}

  create(
    selectionId: string,
    profile: BrowserProfile,
    scopeId: number | null,
    automationAccess: BrowserAgentAccess,
    restoredMetadata?: BrowserTabMetadata,
  ): ManagedTab {
    // Check before WebContentsView touches the partition, then claim immediately
    // after construction. There is no async boundary between these operations.
    this.sessions.assertAvailable(profile);
    const view = new WebContentsView({ webPreferences: secureWebPreferences(profile) });
    const tab: ManagedTab = {
      metadata: restoredMetadata ?? metadataFor(randomUUID(), selectionId, scopeId),
      automationAccess,
      profile,
      view,
      webContents: view.webContents,
      devtoolsView: null,
      devtoolsWebContents: null,
      consoleEntries: [],
      networkEntries: [],
      pendingSessionTasks: new Set(),
      externalAutomationOrigin: null,
    };
    this.sessions.claim(profile);
    return tab;
  }

  register(tab: ManagedTab): void {
    if (tab.webContents.isDestroyed()) throw new Error("Browser tab was destroyed during setup");
    this.tabs.set(tab.metadata.id, tab);
  }

  destroy(tab: ManagedTab): Promise<void> {
    const pending = this.destructions.get(tab);
    if (pending) return pending;
    this.layout.detach(tab.view);
    if (tab.devtoolsView) this.layout.detach(tab.devtoolsView);
    this.tabs.delete(tab.metadata.id);
    const contents = [tab.webContents];
    if (tab.devtoolsWebContents) contents.push(tab.devtoolsWebContents);
    const destroyed = Promise.all(contents.map(waitForDestroyed))
      .then(() => waitForSessionTasks(tab))
      .then(() => this.sessions.release(tab.profile));
    this.destructions.set(tab, destroyed);
    for (const webContents of contents) {
      if (!webContents.isDestroyed()) webContents.close({ waitForBeforeUnload: false });
    }
    return destroyed;
  }
}

function waitForDestroyed(webContents: WebContents): Promise<void> {
  if (webContents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => webContents.once("destroyed", resolve));
}

async function waitForSessionTasks(tab: ManagedTab): Promise<void> {
  while (tab.pendingSessionTasks.size > 0) {
    await Promise.all([...tab.pendingSessionTasks]);
  }
}
