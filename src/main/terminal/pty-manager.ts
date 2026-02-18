import { BrowserWindow } from "electron";
import * as pty from "node-pty";

const TERMINAL_DATA_CHANNEL = "terminal:data";
const TERMINAL_EXIT_CHANNEL = "terminal:exit";

interface ManagedPty {
  pty: pty.IPty;
  featureId: number;
}

/** Map of terminal ID → managed PTY instance */
const ptyInstances = new Map<string, ManagedPty>();

/**
 * Send an IPC event to all renderer windows.
 */
function sendToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

/**
 * Resolve the default shell for the current platform.
 */
function getDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

/**
 * Create a new PTY process and register it.
 *
 * @param id - Unique terminal pane ID
 * @param featureId - The feature/session this terminal belongs to
 * @param cwd - Working directory to open the shell in
 * @param shell - Optional shell override (defaults to user's $SHELL)
 */
export function createPty(
  id: string,
  featureId: number,
  cwd: string,
  shell?: string,
): void {
  // If a PTY with this ID already exists, kill it first
  if (ptyInstances.has(id)) {
    killPty(id);
  }

  const shellPath = shell || getDefaultShell();
  const shellArgs = process.platform === "win32" ? [] : ["-l"];

  const ptyProcess = pty.spawn(shellPath, shellArgs, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
  });

  ptyInstances.set(id, { pty: ptyProcess, featureId });

  // Forward PTY output to the renderer
  ptyProcess.onData((data: string) => {
    sendToAllWindows(TERMINAL_DATA_CHANNEL, { id, data });
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    sendToAllWindows(TERMINAL_EXIT_CHANNEL, { id, exitCode, signal });
    ptyInstances.delete(id);
  });
}

/**
 * Write data (user input) to a PTY.
 */
export function writeToPty(id: string, data: string): void {
  const managed = ptyInstances.get(id);
  if (managed) {
    managed.pty.write(data);
  }
}

/**
 * Resize a PTY to new dimensions.
 */
export function resizePty(id: string, cols: number, rows: number): void {
  const managed = ptyInstances.get(id);
  if (managed) {
    managed.pty.resize(cols, rows);
  }
}

/**
 * Kill a single PTY process and remove it from the map.
 */
export function killPty(id: string): void {
  const managed = ptyInstances.get(id);
  if (managed) {
    try {
      managed.pty.kill();
    } catch {
      // PTY may already be dead — ignore
    }
    ptyInstances.delete(id);
  }
}

/**
 * Kill all PTY processes belonging to a specific feature/session.
 * Used for cleanup when navigating away from a feature.
 */
export function killAllPtysForFeature(featureId: number): void {
  const entries = Array.from(ptyInstances.entries());
  for (const [id, managed] of entries) {
    if (managed.featureId === featureId) {
      try {
        managed.pty.kill();
      } catch {
        // PTY may already be dead — ignore
      }
      ptyInstances.delete(id);
    }
  }
}

/**
 * Kill all PTY processes. Used during app shutdown.
 */
export function killAllPtys(): void {
  const entries = Array.from(ptyInstances.entries());
  for (const [, managed] of entries) {
    try {
      managed.pty.kill();
    } catch {
      // Ignore
    }
  }
  ptyInstances.clear();
}

/**
 * Check if any PTY instances are running.
 */
export function hasRunningPtys(): boolean {
  return ptyInstances.size > 0;
}
