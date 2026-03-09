import { z } from "zod";
import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import { queryOne } from "../db/query";
import type { SettingRow, ProjectRow } from "../db/types";
import { BrowserWindow } from "electron";
import os from "node:os";
import { AppRuntime } from "../effect/runtime";
import { PtyManager } from "../effect/services/PtyManager";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
async function resolveTerminalCwd(featureId: number, projectId: number): Promise<string> {
  const feature = await AppRuntime.runPromise(
    queryOne<{ type: string }>("SELECT type FROM features WHERE id = ?", featureId),
  );

  // For non-session features, try worktree path first
  if (feature && feature.type !== "session") {
    const wtRow = await AppRuntime.runPromise(
      queryOne<Pick<SettingRow, "value">>(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        featureId,
      ),
    );
    if (wtRow) return wtRow.value;
  }

  const project = await AppRuntime.runPromise(
    queryOne<Pick<ProjectRow, "path">>("SELECT path FROM projects WHERE id = ?", projectId),
  );

  if (!project?.path) return os.homedir();
  return project.path;
}

// ---------------------------------------------------------------------------
// Terminal TRPC router
// ---------------------------------------------------------------------------

export const terminalRouter = router({
  /** Create a new PTY terminal for a feature/session */
  create: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const cwd = await resolveTerminalCwd(input.featureId, input.projectId);
      const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "/bin/bash");

      const ptyId = await AppRuntime.runPromise(
        Effect.flatMap(PtyManager, (pm) =>
          Effect.gen(function* () {
            const id = yield* pm.generateId();
            yield* pm.create(id, input.featureId, cwd, shell);

            // Register data callback — broadcast to renderer
            yield* pm.onData(id, (data: string) => {
              broadcast(TERMINAL_DATA_CHANNEL, { ptyId: id, data });
            });

            // Register exit callback — broadcast to renderer
            yield* pm.onExit(id, ({ exitCode, signal }) => {
              broadcast(TERMINAL_EXIT_CHANNEL, { ptyId: id, exitCode, signal });
            });

            return id;
          }),
        ),
      );

      return { ptyId, cwd };
    }),

  /** Reconnect to an existing PTY — returns buffered scrollback */
  reconnect: publicProcedure
    .input(z.object({ ptyId: z.string() }))
    .query(async ({ input }) => {
      try {
        const scrollback = await AppRuntime.runPromise(
          Effect.flatMap(PtyManager, (pm) => pm.getScrollback(input.ptyId)),
        );
        return { alive: true as const, scrollback: scrollback.join("") };
      } catch {
        return { alive: false as const, scrollback: "" };
      }
    }),

  /** Write data to a PTY */
  write: publicProcedure
    .input(
      z.object({
        ptyId: z.string(),
        data: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(
        Effect.flatMap(PtyManager, (pm) => pm.write(input.ptyId, input.data)),
      );
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
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(
        Effect.flatMap(PtyManager, (pm) => pm.resize(input.ptyId, input.cols, input.rows)),
      );
      return { success: true };
    }),

  /** Kill a single PTY */
  kill: publicProcedure
    .input(
      z.object({
        ptyId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(
        Effect.flatMap(PtyManager, (pm) => pm.kill(input.ptyId)),
      );
      return { success: true };
    }),

  /** Kill all PTYs for a given feature */
  killAll: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(
        Effect.flatMap(PtyManager, (pm) => pm.killAllForFeature(input.featureId)),
      );
      return { success: true };
    }),
});
