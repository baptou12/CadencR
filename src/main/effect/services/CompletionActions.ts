/**
 * CompletionActions Effect Service
 *
 * Handles post-run hooks for subprocess completion, pause, stop, and error paths.
 * Extracted from the try/catch blocks in runSdkQuery (subprocess-manager.ts).
 *
 * Each method:
 *  - Updates managed.status (a mutable field on the in-memory subprocess)
 *  - Persists status to DB via SessionPersistence
 *  - Flushes pending throttled notifications via EventBroadcaster
 *  - Calls completion listeners (fire-and-forget)
 *  - Broadcasts the terminal event via EventBroadcaster
 *
 * All methods return Effect.Effect<void> (no error channel) — database errors
 * are caught internally and logged as warnings (best-effort persistence).
 */

import { Context, Effect, Layer } from "effect";
import { SessionPersistence } from "./SessionPersistence.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import { Database } from "./Database.js";
import type { ManagedSubprocess, AgentType, StreamEvent } from "../../agents/types.js";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface CompletionActionsService {
  /** Called when the SDK query finishes normally (status was still "running"). */
  onCompleted: (managed: ManagedSubprocess, sdkSessionId?: string) => Effect.Effect<void>;

  /** Called when the subprocess was interrupted (status is "paused"), in both
   * the normal post-loop path and the catch block. */
  onPaused: (managed: ManagedSubprocess) => Effect.Effect<void>;

  /** Called when the subprocess was stopped (status is "stopped"), in both
   * the normal post-loop path and the catch block. */
  onStopped: (managed: ManagedSubprocess, sdkSessionId?: string) => Effect.Effect<void>;

  /** Called when an unexpected error occurred during the SDK query (not paused/stopped).
   * Handles resume failure recovery and broadcasts the error event. */
  onError: (managed: ManagedSubprocess, error: unknown) => Effect.Effect<void>;
}

/** Context tag for the CompletionActions service */
export class CompletionActions extends Context.Tag("CompletionActions")<
  CompletionActions,
  CompletionActionsService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const CompletionActionsLive = Layer.effect(
  CompletionActions,
  Effect.gen(function* () {
    const sp = yield* SessionPersistence;
    const eb = yield* EventBroadcaster;
    const database = yield* Database;

    return {
      // -----------------------------------------------------------------------
      // onCompleted — SDK query finished, status was still "running"
      // -----------------------------------------------------------------------
      onCompleted: (managed: ManagedSubprocess, sdkSessionId?: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          managed.status = "completed";
          yield* sp
            .persistSessionStatus(managed.id, "completed", sdkSessionId)
            .pipe(Effect.catchAll((e) => Effect.sync(() => {
              console.warn("[CompletionActions] failed to persist completed status:", e);
            })));
          yield* eb.flushNotify(managed.id);
          for (const listener of managed.completionListeners) {
            void listener(0);
          }
          yield* eb.broadcastAgentEvent(
            managed.id,
            managed.agentType as AgentType,
            { type: "agent_done", exitCode: 0 },
          );
        }),

      // -----------------------------------------------------------------------
      // onPaused — subprocess was interrupted (paused), in try or catch block
      // -----------------------------------------------------------------------
      onPaused: (managed: ManagedSubprocess): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* eb.flushNotify(managed.id);
          for (const listener of managed.completionListeners) {
            void listener(2);
          }
          yield* eb.broadcastAgentEvent(
            managed.id,
            managed.agentType as AgentType,
            { type: "agent_paused" },
          );
        }),

      // -----------------------------------------------------------------------
      // onStopped — subprocess was stopped, in try or catch block
      // -----------------------------------------------------------------------
      onStopped: (managed: ManagedSubprocess, sdkSessionId?: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* sp
            .persistSessionStatus(managed.id, "completed", sdkSessionId)
            .pipe(Effect.catchAll((e) => Effect.sync(() => {
              console.warn("[CompletionActions] failed to persist stopped→completed status:", e);
            })));
          yield* eb.flushNotify(managed.id);
          for (const listener of managed.completionListeners) {
            void listener(1);
          }
          yield* eb.broadcastAgentEvent(
            managed.id,
            managed.agentType as AgentType,
            { type: "agent_done", exitCode: 1 },
          );
        }),

      // -----------------------------------------------------------------------
      // onError — unexpected SDK error (not paused/stopped)
      // -----------------------------------------------------------------------
      onError: (managed: ManagedSubprocess, error: unknown): Effect.Effect<void> =>
        Effect.gen(function* () {
          console.error(`[CompletionActions] SDK query failed for ${managed.id}:`, error);

          // Resume failure recovery — restore original claude_session_id and keep paused
          if (managed.resumingFromSessionId) {
            const sDbId = yield* sp.getSessionDbId(managed.id);
            if (sDbId) {
              yield* sp
                .persistClaudeSessionId(sDbId, managed.resumingFromSessionId)
                .pipe(Effect.catchAll((e) => Effect.sync(() => {
                  console.warn("[CompletionActions] failed to restore claude_session_id:", e);
                })));
              // Transition DB session back to paused with no subprocess_id
              yield* database.execute(
                "UPDATE agent_sessions SET status = 'paused', ended_at = ?, subprocess_id = NULL WHERE id = ?",
                new Date().toISOString(),
                sDbId,
              ).pipe(Effect.catchAll((e) => Effect.sync(() => {
                console.warn("[CompletionActions] best-effort transition failed:", e);
              })));
              // Notify renderer about the state change
              const featureRow = yield* database.queryOne<{ feature_id: number | null }>(
                "SELECT feature_id FROM agent_sessions WHERE id = ?",
                sDbId,
              ).pipe(Effect.catchAll(() => Effect.succeed(null)));
              if (featureRow?.feature_id) {
                yield* eb.notifyDbUpdated("agent_session", featureRow.feature_id)
                  .pipe(Effect.catchAll(() => Effect.void));
              }
              console.log(
                `[CompletionActions] Restored session ${sDbId} to paused ` +
                `with original session ID ${managed.resumingFromSessionId}`,
              );
            }
          }

          managed.status = "error";
          yield* eb.flushNotify(managed.id);

          // Persist error status (unless it was a failed resume — we keep DB as paused)
          if (!managed.resumingFromSessionId) {
            yield* sp
              .persistSessionStatus(managed.id, "error")
              .pipe(Effect.catchAll((e) => Effect.sync(() => {
                console.warn("[CompletionActions] failed to persist error status:", e);
              })));
          }

          const rawMessage = error instanceof Error ? error.message : String(error);
          const errorMessage = managed.resumingFromSessionId
            ? `Failed to resume session: ${rawMessage}. The session may have expired. You can try again or start a new session.`
            : rawMessage;

          // Persist error event to DB so it survives stream buffer clear
          const errorSessionDbId = yield* sp.getSessionDbId(managed.id);
          if (errorSessionDbId) {
            yield* sp
              .persistStreamEvent(
                errorSessionDbId,
                { type: "error", error: { type: "sdk_error", message: errorMessage } } as StreamEvent,
              )
              .pipe(Effect.catchAll((e) => Effect.sync(() => {
                console.warn("[CompletionActions] failed to persist error event:", e);
              })));
          }

          yield* eb.broadcastAgentEvent(
            managed.id,
            managed.agentType as AgentType,
            { type: "error", error: { type: "sdk_error", message: errorMessage } },
          );
          for (const listener of managed.completionListeners) {
            void listener(1);
          }
          yield* eb.broadcastAgentEvent(
            managed.id,
            managed.agentType as AgentType,
            { type: "agent_done", exitCode: 1 },
          );
        }),
    };
  }),
);
