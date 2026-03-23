import { app, BrowserWindow } from "electron";
import path from "node:path";
import { Effect } from "effect";
import { createIPCHandler } from "electron-trpc/main";
import { appRouter } from "./main/trpc/router";
import { AppRuntime } from "./main/effect/runtime";
import { startRustBackend, stopRustBackend } from "./main/rust-backend";
import { startElectronIpcServer, stopElectronIpcServer } from "./main/electron-ipc-server";

const ELECTRON_IPC_PORT = 45679;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
import electronSquirrelStartup from "electron-squirrel-startup";
if (electronSquirrelStartup) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 14 },
    backgroundColor: "#1a1b26",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools in development.
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  createIPCHandler({ router: appRouter, windows: [mainWindow] });
};

let isQuitting = false;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on("ready", async () => {
  // Initialize the Effect ManagedRuntime — builds layers, wires services.
  // Running a no-op effect forces lazy initialization so services are ready.
  await AppRuntime.runPromise(Effect.void);

  // Start Electron IPC server (for Rust → Electron callbacks)
  try {
    await startElectronIpcServer(ELECTRON_IPC_PORT);
  } catch (err) {
    console.error("[electron-ipc-server] Failed to start:", err);
  }

  // Start Rust backend for git/features operations
  const dbPath = path.join(app.getPath("userData"), "cadence.db");
  if (app.isPackaged) {
    try {
      await startRustBackend(dbPath, undefined, ELECTRON_IPC_PORT);
    } catch (err) {
      console.error("[rust-backend] Failed to start:", err);
    }
  } else {
    console.log("[rust-backend] Dev mode — expecting Rust backend already running on port 5005");
  }

  createWindow();
});

// Quit when all windows are closed, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();
    // Stop Rust backend and IPC server, then dispose Effect runtime.
    Promise.all([
      app.isPackaged
        ? stopRustBackend().catch((err) => console.error("[rust-backend] Error stopping:", err))
        : Promise.resolve(),
      stopElectronIpcServer().catch((err) => console.error("[electron-ipc-server] Error stopping:", err)),
    ])
      .then(() => AppRuntime.dispose())
      .finally(() => {
        app.quit();
      });
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
