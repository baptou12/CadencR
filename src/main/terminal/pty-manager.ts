/**
 * PTY manager — backward-compatible wrapper around the Effect PtyManager service.
 *
 * All state lives in the PtyManagerLive layer (managed by AppRuntime). These
 * wrapper functions delegate to the Effect service so callers do not need to
 * know about Effect.
 */
import { PtyManager } from "../effect/services/PtyManager.js";
import { AppRuntime } from "../effect/runtime.js";

/**
 * Create a new PTY process and register it.
 *
 * @param id - Unique terminal pane ID
 * @param featureId - The feature/session this terminal belongs to
 * @param cwd - Working directory to open the shell in
 * @param shell - Optional shell override (defaults to user's $SHELL)
 */
export function createPty(id: string, featureId: number, cwd: string, shell?: string): void {
  AppRuntime.runSync(PtyManager.create(id, featureId, cwd, shell));
}

/**
 * Write data (user input) to a PTY.
 */
export function writeToPty(id: string, data: string): void {
  try {
    AppRuntime.runSync(PtyManager.write(id, data));
  } catch {
    // Silently ignore PtyNotFound errors — PTY may have already exited
  }
}

/**
 * Resize a PTY to new dimensions.
 */
export function resizePty(id: string, cols: number, rows: number): void {
  try {
    AppRuntime.runSync(PtyManager.resize(id, cols, rows));
  } catch {
    // Silently ignore PtyNotFound errors — PTY may have already exited
  }
}

/**
 * Kill a single PTY process and remove it from the map.
 */
export function killPty(id: string): void {
  AppRuntime.runSync(PtyManager.kill(id));
}

/**
 * Kill all PTY processes belonging to a specific feature/session.
 * Used for cleanup when navigating away from a feature.
 */
export function killAllPtysForFeature(featureId: number): void {
  AppRuntime.runSync(PtyManager.killAllForFeature(featureId));
}

/**
 * Kill all PTY processes. Used during app shutdown.
 */
export function killAllPtys(): void {
  AppRuntime.runSync(PtyManager.killAll());
}

/**
 * Check if any PTY instances are running.
 */
export function hasRunningPtys(): boolean {
  return AppRuntime.runSync(PtyManager.hasRunning());
}
