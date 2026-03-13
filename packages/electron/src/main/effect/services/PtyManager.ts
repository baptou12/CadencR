import { Effect, Layer } from "effect";
import * as pty from "node-pty";
import { PtyError, PtyNotFound } from "../errors.js";

/** Max bytes of scrollback to keep per PTY for reconnection */
const SCROLLBACK_BUFFER_SIZE = 100_000;

/** Structure held in the internal map */
interface ManagedPty {
  pty: pty.IPty;
  featureId: number;
  /** Circular buffer of recent output for reconnection replay */
  scrollback: string[];
  scrollbackLen: number;
  /** External data callbacks (e.g. tRPC broadcasting) */
  dataCallbacks: Array<(data: string) => void>;
  /** External exit callbacks */
  exitCallbacks: Array<(info: { exitCode: number; signal?: number }) => void>;
}

/** Effect-based interface for PTY management */
export interface PtyManagerService {
  /** Generate a unique PTY ID (incrementing counter) */
  generateId: () => Effect.Effect<string>;
  create: (id: string, featureId: number, cwd: string, shell?: string) => Effect.Effect<void, PtyError>;
  /** Get the scrollback buffer for reconnection */
  getScrollback: (id: string) => Effect.Effect<string[], PtyNotFound>;
  /** Register a data callback for a PTY */
  onData: (id: string, callback: (data: string) => void) => Effect.Effect<void, PtyNotFound>;
  /** Register an exit callback for a PTY */
  onExit: (id: string, callback: (info: { exitCode: number; signal?: number }) => void) => Effect.Effect<void, PtyNotFound>;
  write: (id: string, data: string) => Effect.Effect<void, PtyNotFound>;
  resize: (id: string, cols: number, rows: number) => Effect.Effect<void, PtyNotFound>;
  kill: (id: string) => Effect.Effect<void>;
  killAllForFeature: (featureId: number) => Effect.Effect<void>;
  killAll: () => Effect.Effect<void>;
  hasRunning: () => Effect.Effect<boolean>;
}

/** Context tag for the PtyManager service */
export class PtyManager extends Effect.Tag("PtyManager")<PtyManager, PtyManagerService>() {}

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
    let nextPtyId = 1;

    // Register cleanup finalizer — kills all PTYs when scope/runtime exits
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          ptyInstances.values(),
          (managed) => Effect.try(() => managed.pty.kill()).pipe(Effect.ignoreLogged),
          { concurrency: "unbounded" },
        );
        ptyInstances.clear();
      }),
    );

    return {
      generateId: (): Effect.Effect<string> =>
        Effect.sync(() => `pty-${nextPtyId++}`),

      create: (id: string, featureId: number, cwd: string, shell?: string): Effect.Effect<void, PtyError> =>
        Effect.gen(function* () {
          // Kill existing PTY with same ID if present
          if (ptyInstances.has(id)) {
            const existing = ptyInstances.get(id)!;
            yield* Effect.try(() => existing.pty.kill()).pipe(Effect.ignoreLogged);
            ptyInstances.delete(id);
          }

          yield* Effect.try({
            try: () => {
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

              const managed: ManagedPty = {
                pty: ptyProcess,
                featureId,
                scrollback: [],
                scrollbackLen: 0,
                dataCallbacks: [],
                exitCallbacks: [],
              };
              ptyInstances.set(id, managed);

              // Buffer scrollback and forward to registered callbacks
              ptyProcess.onData((data: string) => {
                // Append to scrollback buffer
                managed.scrollback.push(data);
                managed.scrollbackLen += data.length;
                // Trim from front if over budget
                while (managed.scrollbackLen > SCROLLBACK_BUFFER_SIZE && managed.scrollback.length > 1) {
                  const removed = managed.scrollback.shift()!;
                  managed.scrollbackLen -= removed.length;
                }
                // Notify registered callbacks
                for (const cb of managed.dataCallbacks) {
                  cb(data);
                }
              });

              // Handle PTY exit — notify callbacks and remove from map
              ptyProcess.onExit(({ exitCode, signal }) => {
                for (const cb of managed.exitCallbacks) {
                  cb({ exitCode, signal });
                }
                ptyInstances.delete(id);
              });
            },
            catch: (e) => new PtyError({ message: "Failed to create PTY", cause: e }),
          });
        }),

      getScrollback: (id: string): Effect.Effect<string[], PtyNotFound> =>
        Effect.sync(() => ptyInstances.get(id)).pipe(
          Effect.flatMap((managed) =>
            managed ? Effect.succeed([...managed.scrollback]) : Effect.fail(new PtyNotFound({ id })),
          ),
        ),

      onData: (id: string, callback: (data: string) => void): Effect.Effect<void, PtyNotFound> =>
        Effect.sync(() => ptyInstances.get(id)).pipe(
          Effect.flatMap((managed) =>
            managed
              ? Effect.sync(() => { managed.dataCallbacks.push(callback); })
              : Effect.fail(new PtyNotFound({ id })),
          ),
        ),

      onExit: (id: string, callback: (info: { exitCode: number; signal?: number }) => void): Effect.Effect<void, PtyNotFound> =>
        Effect.sync(() => ptyInstances.get(id)).pipe(
          Effect.flatMap((managed) =>
            managed
              ? Effect.sync(() => { managed.exitCallbacks.push(callback); })
              : Effect.fail(new PtyNotFound({ id })),
          ),
        ),

      write: (id: string, data: string): Effect.Effect<void, PtyNotFound> =>
        Effect.sync(() => ptyInstances.get(id)).pipe(
          Effect.flatMap((managed) =>
            managed
              ? Effect.sync(() => { managed.pty.write(data); })
              : Effect.fail(new PtyNotFound({ id })),
          ),
        ),

      resize: (id: string, cols: number, rows: number): Effect.Effect<void, PtyNotFound> =>
        Effect.sync(() => ptyInstances.get(id)).pipe(
          Effect.flatMap((managed) =>
            managed
              ? Effect.sync(() => { managed.pty.resize(cols, rows); })
              : Effect.fail(new PtyNotFound({ id })),
          ),
        ),

      kill: (id: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const managed = ptyInstances.get(id);
          if (managed) {
            yield* Effect.try(() => managed.pty.kill()).pipe(Effect.ignoreLogged);
            ptyInstances.delete(id);
          }
        }),

      killAllForFeature: (featureId: number): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entries = Array.from(ptyInstances.entries()).filter(
            ([, managed]) => managed.featureId === featureId,
          );
          yield* Effect.forEach(
            entries,
            ([id, managed]) =>
              Effect.try(() => managed.pty.kill()).pipe(
                Effect.ignoreLogged,
                Effect.tap(() => Effect.sync(() => ptyInstances.delete(id))),
              ),
            { concurrency: "unbounded" },
          );
        }),

      killAll: (): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Effect.forEach(
            ptyInstances.values(),
            (managed) => Effect.try(() => managed.pty.kill()).pipe(Effect.ignoreLogged),
            { concurrency: "unbounded" },
          );
          ptyInstances.clear();
        }),

      hasRunning: (): Effect.Effect<boolean> => Effect.sync(() => ptyInstances.size > 0),
    };
  }),
);
