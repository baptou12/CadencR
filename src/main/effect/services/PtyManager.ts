import { Context, Effect, Layer } from "effect";
import * as pty from "node-pty";
import { BrowserWindow } from "electron";
import { PtyError, PtyNotFound } from "../errors.js";

const TERMINAL_DATA_CHANNEL = "terminal:data";
const TERMINAL_EXIT_CHANNEL = "terminal:exit";

/** Structure held in the internal map */
interface ManagedPty {
  pty: pty.IPty;
  featureId: number;
}

/** Effect-based interface for PTY management */
export interface PtyManagerService {
  create: (id: string, featureId: number, cwd: string, shell?: string) => Effect.Effect<void, PtyError>;
  write: (id: string, data: string) => Effect.Effect<void, PtyNotFound>;
  resize: (id: string, cols: number, rows: number) => Effect.Effect<void, PtyNotFound>;
  kill: (id: string) => Effect.Effect<void>;
  killAllForFeature: (featureId: number) => Effect.Effect<void>;
  killAll: () => Effect.Effect<void>;
  hasRunning: () => Effect.Effect<boolean>;
}

/** Context tag for the PtyManager service */
export class PtyManager extends Context.Tag("PtyManager")<PtyManager, PtyManagerService>() {}

/** Send an IPC event to all renderer windows. */
function sendToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

/** Resolve the default shell for the current platform. */
function getDefaultShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

/**
 * Live implementation using node-pty with scoped resource lifecycle.
 * The internal Map is maintained for the lifetime of the scope/runtime.
 * An Effect finalizer ensures all PTYs are killed when the scope closes —
 * this replaces the manual killAllTerminalPtys() call at shutdown.
 */
export const PtyManagerLive = Layer.scoped(
  PtyManager,
  Effect.gen(function* () {
    const ptyInstances = new Map<string, ManagedPty>();

    // Register cleanup finalizer — kills all PTYs when scope/runtime exits
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const [, managed] of ptyInstances) {
          try {
            managed.pty.kill();
          } catch {
            // PTY may already be dead — ignore
          }
        }
        ptyInstances.clear();
      }),
    );

    return {
      create: (id: string, featureId: number, cwd: string, shell?: string): Effect.Effect<void, PtyError> =>
        Effect.try({
          try: () => {
            // Kill existing PTY with same ID if present
            if (ptyInstances.has(id)) {
              const existing = ptyInstances.get(id)!;
              try {
                existing.pty.kill();
              } catch {
                // ignore
              }
              ptyInstances.delete(id);
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

            // Handle PTY exit — remove from map
            ptyProcess.onExit(({ exitCode, signal }) => {
              sendToAllWindows(TERMINAL_EXIT_CHANNEL, { id, exitCode, signal });
              ptyInstances.delete(id);
            });
          },
          catch: (e) => new PtyError({ message: "Failed to create PTY", cause: e }),
        }),

      write: (id: string, data: string): Effect.Effect<void, PtyNotFound> => {
        const managed = ptyInstances.get(id);
        if (!managed) return Effect.fail(new PtyNotFound({ id }));
        return Effect.sync(() => {
          managed.pty.write(data);
        });
      },

      resize: (id: string, cols: number, rows: number): Effect.Effect<void, PtyNotFound> => {
        const managed = ptyInstances.get(id);
        if (!managed) return Effect.fail(new PtyNotFound({ id }));
        return Effect.sync(() => {
          managed.pty.resize(cols, rows);
        });
      },

      kill: (id: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const managed = ptyInstances.get(id);
          if (managed) {
            try {
              managed.pty.kill();
            } catch {
              // PTY may already be dead — ignore
            }
            ptyInstances.delete(id);
          }
        }),

      killAllForFeature: (featureId: number): Effect.Effect<void> =>
        Effect.sync(() => {
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
        }),

      killAll: (): Effect.Effect<void> =>
        Effect.sync(() => {
          for (const [, managed] of ptyInstances) {
            try {
              managed.pty.kill();
            } catch {
              // PTY may already be dead — ignore
            }
          }
          ptyInstances.clear();
        }),

      hasRunning: (): Effect.Effect<boolean> => Effect.sync(() => ptyInstances.size > 0),
    };
  }),
);
