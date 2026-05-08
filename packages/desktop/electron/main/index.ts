import path from "node:path";
import { app, BrowserWindow, dialog, session, shell, type WebContents } from "electron";
import { rendererCsp } from "./csp";
import { loadDevEnv } from "./env";
import { clearRegisteredFilePaths, registerIpc, registerThemeEvents } from "./ipc";
import { installApplicationMenu } from "./menu";
import { approvedExternalUrl, isAllowedNavigationUrl, isLoopbackDevUrl } from "./navigation";
import { setRuntimeConfig } from "./runtime-config";
import {
  createDevSidecarHandle,
  spawnProductionSidecar,
  type SidecarHandle,
  type SidecarStatusUpdate,
} from "./sidecar";
import { createSplashWindow, type SplashHandle } from "./splash";
import { installContextMenu } from "./context-menu";

let mainWindow: BrowserWindow | null = null;
let splash: SplashHandle | null = null;
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
    sidecar = await spawnProductionSidecar({
      appVersion: app.getVersion(),
      onStatus: (update: SidecarStatusUpdate) => splash?.setPhase(update.phase, update.detail),
    });
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
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    // The renderer's async Clipboard API (`navigator.clipboard.writeText` /
    // `.write`) requires `clipboard-sanitized-write` to be granted; without
    // it the write rejects with `NotAllowedError`. Sanitized writes only
    // emit standard MIME types, so granting this is safe.
    if (permission === "clipboard-sanitized-write") {
      callback(true);
      return;
    }
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
  splash = createSplashWindow(app.getVersion());
  splash.setPhase("starting");
  // Cmd+W (or any user-driven close on the splash) means "I want out" — the
  // main window may not exist yet, so the regular close-confirm flow can't
  // run. Quit immediately and let `before-quit` clean up the sidecar.
  splash.onUserClose(() => {
    splash = null;
    app.quit();
  });
  await prepareRuntime();
  mainWindow = createWindow();
  mainWindow.webContents.once("did-finish-load", closeSplash);
  wireMainProcess();
}

function closeSplash(): void {
  if (!splash) return;
  splash.close();
  splash = null;
}

// Refuse a second launch instead of racing port 5004 and stranding a
// second splash window the user can't dismiss. Returning short-circuits
// the rest of this module so the second process doesn't register handlers
// or schedule bootstrap before Electron tears it down.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  throw new Error("second instance — exiting");
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (splash) {
    splash.window.focus();
  }
});

app
  .whenReady()
  .then(() => bootstrap())
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (splash) {
      splash.setError("Cadencr couldn't start", message);
    } else {
      dialog.showErrorBox("Cadencr failed to start", message);
      app.quit();
    }
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
