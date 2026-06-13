import {
  addCommentBadgeScript,
  clearCommentBadgesScript,
  removeCommentBadgeScript,
} from "./browser-comment-overlay-script";
import { captureElementContext } from "./browser-dom";
import { tabDiagnostics } from "./browser-manager-utils";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserElementContext } from "./browser-types";

export async function selectElementContext(
  tab: ManagedTab,
  anchorId?: string,
): Promise<BrowserElementContext> {
  const context = await captureElementContext(
    tab.view.webContents,
    {
      tabId: tab.metadata.id,
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

export async function removeCommentBadge(tab: ManagedTab, anchorId: string): Promise<void> {
  await tab.view.webContents.executeJavaScript(removeCommentBadgeScript(anchorId), true);
}

export async function clearCommentBadges(tab: ManagedTab): Promise<void> {
  await tab.view.webContents.executeJavaScript(clearCommentBadgesScript(), true);
}
