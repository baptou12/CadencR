/**
 * SubprocessLifecycle Effect Service
 *
 * Manages the lifecycle of Claude Agent SDK subprocesses:
 *  - Creating and tracking ManagedSubprocess instances
 *  - Starting/stopping/pausing/interrupting subprocesses
 *  - Sending messages to running or paused subprocesses
 *  - Graceful shutdown with state persistence
 *
 * Extracted from subprocess-manager.ts to complete the subprocess decomposition.
 * Depends on: SdkQueryRunner, SessionPersistence, EventBroadcaster, Database
 *
 * Uses Effect.addFinalizer() to kill all active subprocesses when the runtime
 * disposes, replacing the manual gracefulShutdown() call.
 */

import { Context, Effect, Layer } from "effect";
import { SdkQueryRunner } from "./SdkQueryRunner.js";
import { SessionPersistence } from "./SessionPersistence.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import { Database } from "./Database.js";
import { SdkError } from "../errors.js";
import { loadAllowedPatterns } from "../../agents/permissions.js";
import { resolveModel } from "../../agents/models.js";
import type {
  ManagedSubprocess,
  SubprocessOptions,
  MessageContent,
  AgentType,
} from "../../agents/types.js";

// ---------------------------------------------------------------------------
// Re-export types used by callers of subprocess-manager
// ---------------------------------------------------------------------------

export type { SdkError } from "../errors.js";

export type SendMessageResult = {
  success: boolean;
  reason: "sent" | "resumed" | "no_process" | "invalid_status" | "no_resume_id" | "no_push";
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SubprocessLifecycleService {
  /** Start a new managed subprocess and kick off the SDK query. */
  start: (options: SubprocessOptions) => Effect.Effect<ManagedSubprocess, SdkError>;

  /** Stop a subprocess (running or paused). Alias for pause with allowPaused. */
  stop: (id: string) => Effect.Effect<boolean>;

  /** Interrupt a running subprocess. Pause without allow-paused. */
  interrupt: (id: string) => Effect.Effect<boolean>;

  /** Pause a subprocess. If allowPaused, also accepts already-paused ones. */
  pause: (
    id: string,
    opts?: { allowPaused?: boolean },
  ) => Effect.Effect<boolean>;

  /** Send a user message to a running or paused subprocess. */
  sendMessage: (
    id: string,
    message: MessageContent,
  ) => Effect.Effect<SendMessageResult>;

  /** Change the permission mode of a running subprocess. */
  setPermissionMode: (
    id: string,
    mode: "acceptEdits" | "plan",
  ) => Effect.Effect<boolean>;

  /** List all active subprocesses. */
  list: () => Effect.Effect<
    Array<{ id: string; agentType: string; startedAt: Date; status: string }>
  >;

  /** Returns true if at least one subprocess is currently running. */
  hasRunning: () => Effect.Effect<boolean>;

  /** Get an active subprocess by ID. */
  getActive: (id: string) => Effect.Effect<ManagedSubprocess | undefined>;

  /** Gracefully shut down all subprocesses and save session state. */
  gracefulShutdown: () => Effect.Effect<void>;

  /** Kill all running subprocesses immediately. */
  killAll: () => Effect.Effect<void>;

  /** Pre-generate a subprocess ID for use before start() is called. */
  generateSubprocessId: () => Effect.Effect<string>;
}

/** Context tag for the SubprocessLifecycle service */
export class SubprocessLifecycle extends Context.Tag("SubprocessLifecycle")<
  SubprocessLifecycle,
  SubprocessLifecycleService
>() {}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let globalIdCounter = 0;

function generateId(): string {
  globalIdCounter += 1;
  return `agent-${Date.now()}-${globalIdCounter}`;
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const SubprocessLifecycleLive = Layer.scoped(
  SubprocessLifecycle,
  Effect.gen(function* () {
    const sdkRunner = yield* SdkQueryRunner;
    const sp = yield* SessionPersistence;
    const eb = yield* EventBroadcaster;
    const db = yield* Database;

    // ---------------------------------------------------------------------------
    // Internal state — lives for the lifetime of the service instance
    // ---------------------------------------------------------------------------
    const activeProcesses = new Map<string, ManagedSubprocess>();
    const featureIdCache = new Map<string, number>();

    // ---------------------------------------------------------------------------
    // Register finalizer — kills all active subprocesses on scope exit
    // ---------------------------------------------------------------------------
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const [, managed] of activeProcesses) {
          if (managed.status === "running") {
            managed.status = "stopped";
            managed.abortController?.abort();
          }
        }
      }),
    );

    // ---------------------------------------------------------------------------
    // Private: resolve featureId for a subprocess (for DB lookups)
    // Returns an Effect so callers inside Effect.gen can yield* it properly.
    // ---------------------------------------------------------------------------
    function getFeatureId(managedId: string): Effect.Effect<number | null> {
      const cached = featureIdCache.get(managedId);
      if (cached != null) return Effect.succeed(cached);
      return Effect.gen(function* () {
        const sessionDbId = yield* sp.getSessionDbId(managedId);
        if (!sessionDbId) return null;
        const row = yield* db.queryOne<{ feature_id: number }>(
          "SELECT feature_id FROM agent_sessions WHERE id = ?",
          sessionDbId,
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (row) {
          featureIdCache.set(managedId, row.feature_id);
          return row.feature_id;
        }
        return null;
      });
    }

    /** Resolve the current model for a subprocess by looking up its feature and project. */
    function resolveModelForSubprocess(
      agentType: AgentType,
      featureId: number,
    ): string | undefined {
      try {
        const row = Effect.runSync(
          db.queryOne<{ project_id: number }>(
            "SELECT project_id FROM features WHERE id = ?",
            featureId,
          ),
        );
        return resolveModel(agentType, featureId, row?.project_id);
      } catch {
        return undefined;
      }
    }

    // ---------------------------------------------------------------------------
    // Service implementation
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // Internal helper: pause (used by both pause(), stop(), and interrupt())
    // ---------------------------------------------------------------------------
    const pauseImpl = (
      id: string,
      opts?: { allowPaused?: boolean },
    ): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const managed = activeProcesses.get(id);
        if (!managed) return false;

        const validStatuses = opts?.allowPaused
          ? ["running", "paused"]
          : ["running"];
        if (!validStatuses.includes(managed.status)) return false;

        managed.status = "paused";

        if (managed.query) {
          yield* Effect.tryPromise({
            try: () => managed.query!.interrupt(),
            catch: () => undefined,
          }).pipe(Effect.catchAll(() => Effect.void));
        } else {
          managed.abortController?.abort();
        }

        const sessionDbId = yield* sp.getSessionDbId(id);
        if (sessionDbId) {
          yield* db
            .execute(
              "UPDATE agent_sessions SET status = ?, ended_at = ?, subprocess_id = NULL WHERE id = ?",
              "paused",
              new Date().toISOString(),
              sessionDbId,
            )
            .pipe(Effect.catchAll(() => Effect.void));

          if (managed.sdkSessionId) {
            yield* sp
              .persistClaudeSessionId(sessionDbId, managed.sdkSessionId)
              .pipe(Effect.catchAll(() => Effect.void));
          }
        }

        yield* eb.flushNotify(id);
        yield* eb.broadcastAgentEvent(
          id,
          managed.agentType as AgentType,
          { type: "agent_paused" },
        );

        return true;
      });

    return {
      start: (options: SubprocessOptions): Effect.Effect<ManagedSubprocess, SdkError> =>
        Effect.gen(function* () {
          const id = options.id ?? generateId();
          const abortController = new AbortController();

          const managed: ManagedSubprocess = {
            id,
            agentType: options.agentType,
            startedAt: new Date(),
            status: "running",
            abortController,
            eventListeners: [],
            completionListeners: [],
            originalOptions: options,
            worktreePath: options.worktreePath,
            cachedPermissions: options.worktreePath
              ? loadAllowedPatterns(options.worktreePath)
              : new Set<string>(),
          };

          activeProcesses.set(id, managed);

          // Fire-and-forget: start the SDK query as a daemon fiber (not tied to
          // the current scope so it outlives the runSync/runFork call that
          // invoked start()).
          yield* Effect.forkDaemon(
            sdkRunner.execute(managed, options).pipe(
              Effect.catchAll((err) =>
                Effect.sync(() => {
                  console.error(
                    "[SubprocessLifecycle] Unexpected SDK query error:",
                    err,
                  );
                }),
              ),
            ),
          );

          return managed;
        }),

      pause: pauseImpl,

      stop: (id: string): Effect.Effect<boolean> =>
        pauseImpl(id, { allowPaused: true }),

      interrupt: (id: string): Effect.Effect<boolean> =>
        pauseImpl(id),

      sendMessage: (
        id: string,
        message: MessageContent,
      ): Effect.Effect<SendMessageResult> =>
        Effect.gen(function* () {
          const managed = activeProcesses.get(id);
          if (!managed) return { success: false, reason: "no_process" };

          if (
            managed.status !== "running" &&
            managed.status !== "paused" &&
            managed.status !== "completed"
          ) {
            return { success: false, reason: "invalid_status" };
          }

          // Persist the user message to the database
          const sessionDbId = yield* sp.getSessionDbId(id);
          if (sessionDbId) {
            const persistedContent =
              typeof message === "string" ? message : JSON.stringify(message);
            yield* db
              .execute(
                "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
                sessionDbId,
                "user",
                persistedContent,
                "user_message",
                null,
              )
              .pipe(Effect.catchAll(() => Effect.void));

            const fidForNotify = yield* getFeatureId(id);
            if (fidForNotify != null) {
              yield* eb.notifyDbUpdated("agent_session", fidForNotify);
            }
          }

          // Resume from paused or completed state
          if (managed.status === "paused" || managed.status === "completed") {
            if (!managed.originalOptions) {
              return { success: false, reason: "no_resume_id" };
            }

            managed.status = "running";

            // Update DB status back to running
            const resumeDbId = yield* sp.getSessionDbId(id);
            if (resumeDbId) {
              yield* db
                .execute(
                  "UPDATE agent_sessions SET status = ?, ended_at = NULL WHERE id = ?",
                  "running",
                  resumeDbId,
                )
                .pipe(Effect.catchAll(() => Effect.void));
            }

            // Fresh abort controller for the resumed query
            managed.abortController = new AbortController();

            // Re-resolve model in case user changed settings
            let freshModel = managed.originalOptions.model;
            const fidForResume = yield* getFeatureId(id);
            if (fidForResume) {
              freshModel =
                resolveModelForSubprocess(managed.agentType as AgentType, fidForResume) ??
                freshModel;
            }

            const resumeOptions: SubprocessOptions = {
              ...managed.originalOptions,
              prompt: message,
              ...(managed.sdkSessionId
                ? { resumeSessionId: managed.sdkSessionId }
                : {}),
              model: freshModel,
            };

            // Re-run the SDK query as a daemon fiber (fire-and-forget)
            yield* Effect.forkDaemon(
              sdkRunner.execute(managed, resumeOptions).pipe(
                Effect.catchAll((err) =>
                  Effect.sync(() => {
                    console.error(
                      `[SubprocessLifecycle] Resume SDK query failed for ${id}:`,
                      err,
                    );
                  }),
                ),
              ),
            );

            return { success: true, reason: "resumed" };
          }

          if (!managed.pushMessage) {
            return { success: false, reason: "no_push" };
          }

          // Re-resolve the model in case the user changed it in settings
          if (managed.query) {
            const fidForModel = yield* getFeatureId(id);
            const freshModel = fidForModel
              ? resolveModelForSubprocess(managed.agentType as AgentType, fidForModel)
              : undefined;
            if (freshModel) {
              void managed.query.setModel(freshModel).catch(() => { /* best-effort */ });
            }
          }

          managed.pushMessage(message);
          return { success: true, reason: "sent" };
        }),

      setPermissionMode: (
        id: string,
        mode: "acceptEdits" | "plan",
      ): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const managed = activeProcesses.get(id);
          if (!managed || !managed.query || managed.status !== "running")
            return false;
          yield* Effect.tryPromise({
            try: () => managed.query!.setPermissionMode(mode),
            catch: () => undefined,
          }).pipe(Effect.catchAll(() => Effect.void));
          return true;
        }),

      list: (): Effect.Effect<
        Array<{ id: string; agentType: string; startedAt: Date; status: string }>
      > =>
        Effect.sync(() =>
          Array.from(activeProcesses.values()).map((m) => ({
            id: m.id,
            agentType: m.agentType,
            startedAt: m.startedAt,
            status: m.status,
          })),
        ),

      hasRunning: (): Effect.Effect<boolean> =>
        Effect.sync(() => {
          for (const [, managed] of activeProcesses) {
            if (managed.status === "running") return true;
          }
          return false;
        }),

      getActive: (id: string): Effect.Effect<ManagedSubprocess | undefined> =>
        Effect.sync(() => activeProcesses.get(id)),

      gracefulShutdown: (): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* sp.saveAllSessionStates().pipe(
            Effect.catchAll((e) =>
              Effect.sync(() => {
                console.warn(
                  "[SubprocessLifecycle] saveAllSessionStates failed:",
                  e,
                );
              }),
            ),
          );
          yield* Effect.sync(() => {
            for (const [, managed] of activeProcesses) {
              if (managed.status === "running") {
                managed.status = "stopped";
                managed.abortController?.abort();
              }
            }
          });
        }),

      killAll: (): Effect.Effect<void> =>
        Effect.sync(() => {
          for (const [, managed] of activeProcesses) {
            if (managed.status === "running") {
              managed.status = "stopped";
              managed.abortController?.abort();
            }
          }
        }),

      generateSubprocessId: (): Effect.Effect<string> =>
        Effect.sync(() => generateId()),
    };
  }),
);
