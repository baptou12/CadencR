import { ipcMain, type BrowserWindow } from "electron";
import {
  optionalString,
  parseBounds,
  requiredNumber,
  requiredString,
} from "./browser-arg-validation";
import { BrowserManager } from "./browser-manager";
import { assertTrustedSender } from "./ipc";

interface BrowserIpcOptions {
  getMainWindow: () => BrowserWindow | null;
}

export function registerBrowserIpc(options: BrowserIpcOptions): BrowserManager {
  const manager = new BrowserManager(options.getMainWindow);
  ipcMain.handle("browser:create-tab", (event, rawUrl: unknown, profileId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.createTab(optionalString(rawUrl), optionalString(profileId) ?? "fresh");
  });
  ipcMain.handle("browser:list-tabs", (event) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.state();
  });
  ipcMain.handle("browser:navigate", (event, tabId: unknown, rawUrl: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.navigate(requiredString(tabId, "tab id"), requiredString(rawUrl, "URL"));
  });
  ipcMain.handle("browser:activate-tab", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.activateTab(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:close-tab", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.closeTab(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:set-bounds", (event, bounds: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.setBounds(parseBounds(bounds));
  });
  ipcMain.handle("browser:set-suppressed", (event, value: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    manager.setSuppressed(value === true);
  });
  ipcMain.handle("browser:list-profiles", (event) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.listProfiles();
  });
  ipcMain.handle("browser:clear-storage", (event, profileId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.clearStorage(requiredString(profileId, "profile id"));
  });
  ipcMain.handle("browser:create-profile", (event, profileId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.createProfile(requiredString(profileId, "profile id"));
  });
  ipcMain.handle("browser:duplicate-profile", (event, sourceId: unknown, newId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.duplicateProfile(
      requiredString(sourceId, "source profile id"),
      requiredString(newId, "new profile id"),
    );
  });
  ipcMain.handle("browser:delete-profile", (event, profileId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    manager.deleteProfile(requiredString(profileId, "profile id"));
  });
  ipcMain.handle("browser:back", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    manager.goBack(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:forward", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    manager.goForward(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:reload", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    manager.reload(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:stop", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    manager.stop(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:toggle-devtools", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.toggleDevTools(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:get-console", (event) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.state().consoleEntries;
  });
  ipcMain.handle("browser:get-network", (event) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.state().networkEntries;
  });
  ipcMain.handle("browser:get-snapshot", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.snapshot(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:screenshot", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.screenshot(requiredString(tabId, "tab id"));
  });
  ipcMain.handle("browser:click", (event, tabId: unknown, x: unknown, y: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.click(
      requiredString(tabId, "tab id"),
      requiredNumber(x, "x"),
      requiredNumber(y, "y"),
    );
  });
  ipcMain.handle("browser:type", (event, tabId: unknown, text: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.typeText(requiredString(tabId, "tab id"), requiredString(text, "text"));
  });
  ipcMain.handle("browser:keypress", (event, tabId: unknown, keyCode: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.keypress(requiredString(tabId, "tab id"), requiredString(keyCode, "key"));
  });
  ipcMain.handle("browser:select-element-context", (event, tabId: unknown, anchorId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.selectElementContext(
      requiredString(tabId, "tab id"),
      requiredString(anchorId, "anchor id"),
    );
  });
  ipcMain.handle("browser:remove-comment-badge", (event, tabId: unknown, anchorId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.removeCommentBadge(
      requiredString(tabId, "tab id"),
      requiredString(anchorId, "anchor id"),
    );
  });
  ipcMain.handle("browser:clear-comment-badges", (event, tabId: unknown) => {
    assertTrustedSender(event, options.getMainWindow);
    return manager.clearCommentBadges(requiredString(tabId, "tab id"));
  });
  return manager;
}
