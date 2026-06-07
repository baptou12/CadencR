/**
 * Sleep prevention + suspend/resume IPC forwarding for the main process.
 *
 * - A single `powerSaveBlocker('prevent-app-suspension')` is held while ANY
 *   reason is active. We use `prevent-app-suspension` (NOT
 *   `prevent-display-sleep`) so the screen can still turn off / lock; only
 *   idle *system* sleep is blocked. Two independent reasons drive it:
 *     - `"agents"`      — set via `power:set-busy` while agent turns stream.
 *     - `"remote-host"` — set via `power:set-remote-host` while the user has
 *                         opted into keeping the Mac awake for remote hosting.
 *   Tracking reasons in a set keeps the two callers from clobbering each
 *   other (agents finishing must not release a blocker remote hosting still
 *   wants), and makes start/stop idempotent.
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

type SleepReason = "agents" | "remote-host";

let blockerId: number | null = null;
const activeReasons = new Set<SleepReason>();
let onSuspend: (() => void) | null = null;
let onResume: (() => void) | null = null;

/** Hold the blocker while any reason is active; release it once none are. */
function syncBlocker(): void {
  if (activeReasons.size > 0) {
    // Idempotent: never stack a second blocker on top of a live one.
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

function setReason(reason: SleepReason, active: boolean): void {
  if (active) activeReasons.add(reason);
  else activeReasons.delete(reason);
  syncBlocker();
}

function parseBoolean(raw: unknown, channel: string): boolean {
  if (typeof raw !== "boolean") {
    throw new Error(`${channel} expected a boolean.`);
  }
  return raw;
}

export function registerPower({ getMainWindow }: PowerOptions): void {
  if (onSuspend) return;
  ipcMain.handle("power:set-busy", (event, raw: unknown) => {
    assertTrustedSender(event, getMainWindow);
    setReason("agents", parseBoolean(raw, "power:set-busy"));
  });
  ipcMain.handle("power:set-remote-host", (event, raw: unknown) => {
    assertTrustedSender(event, getMainWindow);
    setReason("remote-host", parseBoolean(raw, "power:set-remote-host"));
  });
  onSuspend = () => sendToWindow(getMainWindow(), "power:suspend");
  onResume = () => sendToWindow(getMainWindow(), "power:resume");
  powerMonitor.on("suspend", onSuspend);
  powerMonitor.on("resume", onResume);
}

export function shutdownPower(): void {
  if (!onSuspend || !onResume) return;
  ipcMain.removeHandler("power:set-busy");
  ipcMain.removeHandler("power:set-remote-host");
  powerMonitor.removeListener("suspend", onSuspend);
  powerMonitor.removeListener("resume", onResume);
  onSuspend = null;
  onResume = null;
  // Drop every reason so app quit can't strand a held assertion.
  activeReasons.clear();
  syncBlocker();
}
