// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";
import { exposeElectronTRPC } from "electron-trpc/main";

const AGENT_EVENT_CHANNEL = "agent:event";
const ASK_USER_QUESTION_CHANNEL = "agent:ask-user-question";

process.once("loaded", () => {
  exposeElectronTRPC();

  contextBridge.exposeInMainWorld("api", {
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
  });
});
