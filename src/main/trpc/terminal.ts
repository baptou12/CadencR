import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { SettingRow, ProjectRow } from "../db/types";
import { BrowserWindow } from "electron";
import * as pty from "node-pty";
import os from "node:os";

// ---------------------------------------------------------------------------
// PTY instance management
// ---------------------------------------------------------------------------

/** Max bytes of scrollback to keep per PTY for reconnection */
const SCROLLBACK_BUFFER_SIZE = 100_000;

interface PtyInstance {
  ptyProcess: pty.IPty;
  featureId: number;
  /** Circular buffer of recent output for reconnection replay */
  scrollback: string[];
  scrollbackLen: number;
}

const ptyInstances = new Map<string, PtyInstance>();
let nextPtyId = 1;

const TERMINAL_DATA_CHANNEL = "terminal:data";
const TERMINAL_EXIT_CHANNEL = "terminal:exit";

/** Broadcast an event to all renderer windows. */
function broadcast(channel: string, data: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

/**
 * Resolve the working directory for a terminal.
 * Session features use the project path; workflow features prefer worktree path.
 */
function resolveTerminalCwd(featureId: number, projectId: number): string {
  const db = getDatabase();

  const feature = db
    .prepare("SELECT type FROM features WHERE id = ?")
    .get(featureId) as { type: string } | undefined;

  // For non-session features, try worktree path first
  if (feature && feature.type !== "session") {
    const wtRow = db
      .prepare(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
      )
      .get(featureId) as SettingRow | undefined;
    if (wtRow) return wtRow.value;
  }

  const project = db
    .prepare("SELECT path FROM projects WHERE id = ?")
    .get(projectId) as Pick<ProjectRow, "path"> | undefined;

  if (!project?.path) return os.homedir();
  return project.path;
}

// ---------------------------------------------------------------------------
// Terminal TRPC router
// ---------------------------------------------------------------------------

/**
 * Kill all PTY instances. Used during app shutdown for graceful cleanup.
 */
export function killAllTerminalPtys(): void {
  for (const [id, instance] of ptyInstances) {
    try {
      instance.ptyProcess.kill();
    } catch {
      // PTY may already be dead — ignore
    }
    ptyInstances.delete(id);
  }
}

export const terminalRouter = router({
  /** Create a new PTY terminal for a feature/session */
  create: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const cwd = resolveTerminalCwd(input.featureId, input.projectId);
      const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/bash");

      const ptyId = `pty-${nextPtyId++}`;

      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd,
        env: process.env as Record<string, string>,
      });

      const instance: PtyInstance = {
        ptyProcess,
        featureId: input.featureId,
        scrollback: [],
        scrollbackLen: 0,
      };
      ptyInstances.set(ptyId, instance);

      // Forward PTY data to renderer and buffer for reconnection
      ptyProcess.onData((data: string) => {
        // Append to scrollback buffer
        instance.scrollback.push(data);
        instance.scrollbackLen += data.length;
        // Trim from front if over budget
        while (instance.scrollbackLen > SCROLLBACK_BUFFER_SIZE && instance.scrollback.length > 1) {
          const removed = instance.scrollback.shift()!;
          instance.scrollbackLen -= removed.length;
        }
        broadcast(TERMINAL_DATA_CHANNEL, { ptyId, data });
      });

      // Handle PTY exit
      ptyProcess.onExit(({ exitCode, signal }) => {
        broadcast(TERMINAL_EXIT_CHANNEL, { ptyId, exitCode, signal });
        ptyInstances.delete(ptyId);
      });

      return { ptyId, cwd };
    }),

  /** Reconnect to an existing PTY — returns buffered scrollback */
  reconnect: publicProcedure
    .input(z.object({ ptyId: z.string() }))
    .query(({ input }) => {
      const instance = ptyInstances.get(input.ptyId);
      if (!instance) return { alive: false as const, scrollback: "" };
      return { alive: true as const, scrollback: instance.scrollback.join("") };
    }),

  /** Write data to a PTY */
  write: publicProcedure
    .input(
      z.object({
        ptyId: z.string(),
        data: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const instance = ptyInstances.get(input.ptyId);
      if (!instance) throw new Error(`PTY not found: ${input.ptyId}`);
      instance.ptyProcess.write(input.data);
      return { success: true };
    }),

  /** Resize a PTY */
  resize: publicProcedure
    .input(
      z.object({
        ptyId: z.string(),
        cols: z.number(),
        rows: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const instance = ptyInstances.get(input.ptyId);
      if (!instance) throw new Error(`PTY not found: ${input.ptyId}`);
      instance.ptyProcess.resize(input.cols, input.rows);
      return { success: true };
    }),

  /** Kill a single PTY */
  kill: publicProcedure
    .input(
      z.object({
        ptyId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const instance = ptyInstances.get(input.ptyId);
      if (!instance) return { success: false };
      instance.ptyProcess.kill();
      ptyInstances.delete(input.ptyId);
      return { success: true };
    }),

  /** Kill all PTYs for a given feature */
  killAll: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      let killed = 0;
      for (const [id, instance] of ptyInstances) {
        if (instance.featureId === input.featureId) {
          instance.ptyProcess.kill();
          ptyInstances.delete(id);
          killed++;
        }
      }
      return { killed };
    }),
});
