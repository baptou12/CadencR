// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge } from "electron";
import { exposeElectronTRPC } from "electron-trpc/main";

process.once("loaded", () => {
  exposeElectronTRPC();

  contextBridge.exposeInMainWorld("api", {
    rustBackendUrl: `http://localhost:${process.env.CADENCE_RUST_PORT || "5005"}`,
  });
});
