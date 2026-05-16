import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import pkg from "electron-updater";
import { assertTrustedSender } from "./ipc";
import { sendToWindow } from "./safe-send";

// `electron-updater` ships as CommonJS; the `autoUpdater` named export is on
// the default module object when imported from ESM/TS.
const { autoUpdater } = pkg;

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FIRST_CHECK_DELAY_MS = 10_000; // 10 s after ready — let the sidecar boot

type UpdateChannel =
  | { channel: "update:checking" }
  | { channel: "update:available"; version: string; releaseNotes: string | null }
  | { channel: "update:not-available"; version: string }
  | { channel: "update:error"; message: string }
  | { channel: "update:download-progress"; percent: number; bytesPerSecond: number }
  | { channel: "update:downloaded"; version: string };

let initialized = false;
let registered = false;
let intervalHandle: NodeJS.Timeout | null = null;

interface InitOptions {
  getMainWindow: () => BrowserWindow | null;
}

export function registerAutoUpdaterIpc({ getMainWindow }: InitOptions): void {
  if (registered) return;
  registered = true;
  ipcMain.handle("app:check-for-updates", (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event, getMainWindow);
    if (!app.isPackaged) {
      sendUpdate(getMainWindow, {
        channel: "update:error",
        message: "Updates are disabled in dev builds.",
      });
      return;
    }
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      sendUpdate(getMainWindow, { channel: "update:error", message: errorMessage(error) });
    });
  });
  ipcMain.handle("app:install-update", (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event, getMainWindow);
    if (!app.isPackaged) return;
    // `quitAndInstall(isSilent, isForceRunAfter)` — silent install, relaunch.
    autoUpdater.quitAndInstall(false, true);
  });
}

export function initAutoUpdater({ getMainWindow }: InitOptions): void {
  if (initialized) return;
  initialized = true;
  if (!app.isPackaged) {
    console.info("[updater] dev build — skipping auto-update setup");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on("checking-for-update", () => {
    sendUpdate(getMainWindow, { channel: "update:checking" });
  });
  autoUpdater.on("update-available", (info) => {
    sendUpdate(getMainWindow, {
      channel: "update:available",
      version: info.version,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
    });
  });
  autoUpdater.on("update-not-available", (info) => {
    sendUpdate(getMainWindow, {
      channel: "update:not-available",
      version: info.version ?? app.getVersion(),
    });
  });
  autoUpdater.on("error", (error) => {
    sendUpdate(getMainWindow, { channel: "update:error", message: errorMessage(error) });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendUpdate(getMainWindow, {
      channel: "update:download-progress",
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdate(getMainWindow, { channel: "update:downloaded", version: info.version });
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      sendUpdate(getMainWindow, { channel: "update:error", message: errorMessage(error) });
    });
  }, FIRST_CHECK_DELAY_MS);

  intervalHandle = setInterval(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      sendUpdate(getMainWindow, { channel: "update:error", message: errorMessage(error) });
    });
  }, CHECK_INTERVAL_MS);
}

export function shutdownAutoUpdater(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function sendUpdate(getMainWindow: () => BrowserWindow | null, payload: UpdateChannel): void {
  const { channel, ...data } = payload;
  sendToWindow(getMainWindow(), channel, data);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
