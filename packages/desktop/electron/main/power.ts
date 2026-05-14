/**
 * Sleep prevention + suspend/resume IPC forwarding for the main process.
 *
 * - `powerSaveBlocker('prevent-app-suspension')` is ref-counted by the
 *   renderer via `power:set-busy`. We use `prevent-app-suspension` (NOT
 *   `prevent-display-sleep`) so the screen can still turn off; only the
 *   system sleep is blocked while agents stream.
 * - `powerMonitor.suspend` / `resume` are forwarded to the renderer
 *   via `power:suspend` / `power:resume`. The renderer reacts by
 *   sending `session.suspend` / `session.resume` per active session.
 */

import { ipcMain, powerMonitor, powerSaveBlocker, type BrowserWindow } from "electron";
import { assertTrustedSender } from "./ipc";
import { sendToWindow } from "./safe-send";

export interface PowerOptions {
  getMainWindow: () => BrowserWindow | null;
}

let blockerId: number | null = null;
let onSuspend: (() => void) | null = null;
let onResume: (() => void) | null = null;

function applyBusy(busy: boolean): void {
  if (busy) {
    // Idempotent: don't stack blockers if the renderer sends `true` twice.
    if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return;
    blockerId = powerSaveBlocker.start("prevent-app-suspension");
    return;
  }
  if (blockerId === null) return;
  if (powerSaveBlocker.isStarted(blockerId)) {
    try {
      powerSaveBlocker.stop(blockerId);
    } catch (error) {
      // `stop()` throws if the id is unknown — log so this doesn't become
      // an invisible "system never sleeps" bug.
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`powerSaveBlocker.stop failed: ${message}`);
    }
  }
  blockerId = null;
}

function parseBusy(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new Error("power:set-busy expected a boolean.");
  }
  return raw;
}

export function registerPower({ getMainWindow }: PowerOptions): void {
  if (onSuspend) return;
  ipcMain.handle("power:set-busy", (event, raw: unknown) => {
    assertTrustedSender(event, getMainWindow);
    applyBusy(parseBusy(raw));
  });
  onSuspend = () => sendToWindow(getMainWindow(), "power:suspend");
  onResume = () => sendToWindow(getMainWindow(), "power:resume");
  powerMonitor.on("suspend", onSuspend);
  powerMonitor.on("resume", onResume);
}

export function shutdownPower(): void {
  if (!onSuspend || !onResume) return;
  ipcMain.removeHandler("power:set-busy");
  powerMonitor.removeListener("suspend", onSuspend);
  powerMonitor.removeListener("resume", onResume);
  onSuspend = null;
  onResume = null;
  applyBusy(false);
}
