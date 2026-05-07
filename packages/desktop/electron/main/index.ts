import path from "node:path";
import { app, BrowserWindow, dialog, session, shell, type WebContents } from "electron";
import { rendererCsp } from "./csp";
import { loadDevEnv } from "./env";
import { clearRegisteredFilePaths, registerIpc, registerThemeEvents } from "./ipc";
import { installApplicationMenu } from "./menu";
import { approvedExternalUrl, isAllowedNavigationUrl, isLoopbackDevUrl } from "./navigation";
import { setRuntimeConfig } from "./runtime-config";
import { createDevSidecarHandle, spawnProductionSidecar, type SidecarHandle } from "./sidecar";
import { installContextMenu } from "./context-menu";

let mainWindow: BrowserWindow | null = null;
let sidecar: SidecarHandle | null = null;
let allowClose = false;
let pendingQuit = false;
let ipcRegistered = false;
let themeEventsRegistered = false;
let sidecarStopPromise: Promise<void> | null = null;

function installCsp(): void {
  const csp = rendererCsp(app.isPackaged);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
}

async function prepareRuntime(): Promise<void> {
  if (app.isPackaged) {
    sidecar = await spawnProductionSidecar();
  } else {
    const dotenvPath = loadDevEnv();
    console.info(`Loaded env from ${dotenvPath}`);
    sidecar = createDevSidecarHandle();
  }
  setRuntimeConfig({ baseUrl: sidecar.baseUrl, authToken: sidecar.authToken });
}

function sendCloseRequest(): void {
  mainWindow?.webContents.send("app:close-requested");
}

function requestQuit(): void {
  pendingQuit = true;
  sendCloseRequest();
}

function rendererLoadUrl(): { kind: "url"; value: string } | { kind: "file"; value: string } {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererUrl) {
    if (!isLoopbackDevUrl(rendererUrl)) {
      throw new Error(`Rejected untrusted ELECTRON_RENDERER_URL: ${rendererUrl}`);
    }
    return { kind: "url", value: rendererUrl };
  }
  return { kind: "file", value: path.join(__dirname, "../renderer/index.html") };
}

function secureWebContents(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    void openApprovedExternalUrl(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigationUrl(url, app.isPackaged)) return;
    event.preventDefault();
    void openApprovedExternalUrl(url);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

async function openApprovedExternalUrl(rawUrl: string): Promise<void> {
  const url = approvedExternalUrl(rawUrl);
  if (url) await shell.openExternal(url);
}

function createWindow(): BrowserWindow {
  allowClose = false;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  secureWebContents(win.webContents);
  installContextMenu(win, win.webContents);

  win.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    pendingQuit = false;
    win.webContents.send("app:close-requested");
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("did-start-navigation", () => clearRegisteredFilePaths());

  const loadTarget = rendererLoadUrl();
  if (loadTarget.kind === "url") void win.loadURL(loadTarget.value);
  else void win.loadFile(loadTarget.value);
  return win;
}

function confirmClose(): void {
  allowClose = true;
  if (pendingQuit) app.quit();
  else mainWindow?.close();
}

function wireMainProcess(): void {
  if (!ipcRegistered) {
    registerIpc({ getMainWindow: () => mainWindow, confirmClose, requestQuit });
    ipcRegistered = true;
  }
  if (!themeEventsRegistered) {
    registerThemeEvents(() => mainWindow);
    themeEventsRegistered = true;
  }
}

async function bootstrap(): Promise<void> {
  installCsp();
  installApplicationMenu(requestQuit);
  await prepareRuntime();
  mainWindow = createWindow();
  wireMainProcess();
}

app
  .whenReady()
  .then(() => bootstrap())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Cadencr failed to start", message);
    app.quit();
  });

app.on("before-quit", (event) => {
  if (!allowClose && mainWindow) {
    event.preventDefault();
    requestQuit();
    return;
  }
  if (sidecar) {
    event.preventDefault();
    void stopSidecarThenQuit();
  }
});

async function stopSidecarThenQuit(): Promise<void> {
  if (!sidecarStopPromise) {
    const currentSidecar = sidecar;
    if (!currentSidecar) return;
    sidecar = null;
    closeAllWindowsForQuit();
    sidecarStopPromise = currentSidecar.stop().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to stop cadencr-service cleanly: ${message}`);
    });
  }
  await sidecarStopPromise;
  app.quit();
}

function closeAllWindowsForQuit(): void {
  allowClose = true;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.close();
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    wireMainProcess();
  }
});
