// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import { exposeElectronTRPC } from "electron-trpc/main";

const AGENT_EVENT_CHANNEL = "agent:event";
const ASK_USER_QUESTION_CHANNEL = "agent:ask-user-question";
const TOOL_PERMISSION_CHANNEL = "agent:tool-permission";
const DB_UPDATED_CHANNEL = "db:updated";
const BACKGROUND_TASK_CHANNEL = "agent:background-tasks";

process.once("loaded", () => {
  exposeElectronTRPC();

  contextBridge.exposeInMainWorld("api", {
    rustBackendUrl: `http://localhost:${process.env.CADENCE_RUST_PORT || "5005"}`,
    onAgentEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        callback(data);
      };
      ipcRenderer.on(AGENT_EVENT_CHANNEL, listener);
      // Return the listener reference so it can be removed
      return listener;
    },
    offAgentEvent: (listener?: (...args: unknown[]) => void) => {
      if (listener) {
        ipcRenderer.removeListener(
          AGENT_EVENT_CHANNEL,
          listener as (...args: unknown[]) => void,
        );
      } else {
        ipcRenderer.removeAllListeners(AGENT_EVENT_CHANNEL);
      }
    },
    onAskUserQuestion: (callback: (data: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        callback(data);
      };
      ipcRenderer.on(ASK_USER_QUESTION_CHANNEL, listener);
      return listener;
    },
    offAskUserQuestion: (listener?: (...args: unknown[]) => void) => {
      if (listener) {
        ipcRenderer.removeListener(
          ASK_USER_QUESTION_CHANNEL,
          listener as (...args: unknown[]) => void,
        );
      } else {
        ipcRenderer.removeAllListeners(ASK_USER_QUESTION_CHANNEL);
      }
    },
    onToolPermission: (callback: (data: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        callback(data);
      };
      ipcRenderer.on(TOOL_PERMISSION_CHANNEL, listener);
      return listener;
    },
    offToolPermission: (listener?: (...args: unknown[]) => void) => {
      if (listener) {
        ipcRenderer.removeListener(
          TOOL_PERMISSION_CHANNEL,
          listener as (...args: unknown[]) => void,
        );
      } else {
        ipcRenderer.removeAllListeners(TOOL_PERMISSION_CHANNEL);
      }
    },
    onDbUpdated: (callback: (data: { entity: string; featureId: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: { entity: string; featureId: number }) => {
        callback(data);
      };
      ipcRenderer.on(DB_UPDATED_CHANNEL, listener);
      return listener;
    },
    offDbUpdated: (listener?: (...args: unknown[]) => void) => {
      if (listener) {
        ipcRenderer.removeListener(
          DB_UPDATED_CHANNEL,
          listener as (...args: unknown[]) => void,
        );
      } else {
        ipcRenderer.removeAllListeners(DB_UPDATED_CHANNEL);
      }
    },
    onBackgroundTasks: (callback: (data: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        callback(data);
      };
      ipcRenderer.on(BACKGROUND_TASK_CHANNEL, listener);
      return listener;
    },
    offBackgroundTasks: (listener?: (...args: unknown[]) => void) => {
      if (listener) {
        ipcRenderer.removeListener(
          BACKGROUND_TASK_CHANNEL,
          listener as (...args: unknown[]) => void,
        );
      } else {
        ipcRenderer.removeAllListeners(BACKGROUND_TASK_CHANNEL);
      }
    },
  });
});
