import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { createIPCHandler } from "electron-trpc/main";
import { appRouter } from "./main/trpc/router";
import { closeDatabase } from "./main/db/database";
import { hasRunningSubprocesses, gracefulShutdown } from "./main/agents/subprocess-manager";
import { restoreSessionMap } from "./main/agents/ipc-bridge";
import { fetchAvailableModels } from "./main/agents/available-models";

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

  mainWindow.on("close", (e) => {
    if (!isQuitting && hasRunningSubprocesses()) {
      e.preventDefault();
      dialog
        .showMessageBox(mainWindow, {
          type: "warning",
          title: "Agents Running",
          message: "AI agents are still running. Closing now will interrupt them.",
          detail: "Agent sessions can be resumed when you reopen the app.",
          buttons: ["Wait", "Quit Anyway"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(({ response }) => {
          if (response === 1) {
            gracefulShutdown();
            mainWindow.destroy();
          }
        });
    }
  });
};

let isQuitting = false;

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on("ready", () => {
  fetchAvailableModels().catch(() => {}); // warm up cache
  // Restore in-memory session map from DB (for reconnection after restart)
  restoreSessionMap();
  createWindow();
});

// Quit when all windows are closed, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (e) => {
  if (!isQuitting && hasRunningSubprocesses()) {
    e.preventDefault();
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      dialog
        .showMessageBox(win, {
          type: "warning",
          title: "Agents Running",
          message: "AI agents are still running. Quitting now will interrupt them.",
          detail: "Agent sessions can be resumed when you reopen the app.",
          buttons: ["Wait", "Quit Anyway"],
          defaultId: 0,
          cancelId: 0,
        })
        .then(({ response }) => {
          if (response === 1) {
            isQuitting = true;
            gracefulShutdown();
            closeDatabase();
            app.quit();
          }
        });
    }
  } else {
    gracefulShutdown();
    closeDatabase();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
