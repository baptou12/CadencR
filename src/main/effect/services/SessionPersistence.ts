/**
 * SessionPersistence Effect Service
 *
 * Effect-typed service that handles all database persistence for agent sessions:
 * - Session map (managedId → sessionDbId) management
 * - Stream event persistence to agent_messages
 * - Session status transitions
 * - Token usage tracking
 * - App startup/shutdown state management
 */

import { Context, Effect, Layer } from "effect";
import { Database } from "./Database.js";
import { DatabaseError } from "../errors.js";
import type { StreamEvent, StreamSystemEvent } from "../../agents/types.js";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SessionPersistenceService {
  /** Persist a stream event to the agent_messages table. */
  persistStreamEvent: (
    sessionDbId: number,
    event: StreamEvent,
    parentToolUseId?: string | null,
  ) => Effect.Effect<void, DatabaseError>;

  /** Persist session status to DB (best-effort). Used on completed/stopped/error transitions. */
  persistSessionStatus: (
    managedId: string,
    status: string,
    sdkSessionId?: string,
  ) => Effect.Effect<void, DatabaseError>;

  /** Persist a Claude session ID to the agent_sessions table. */
  persistClaudeSessionId: (
    sessionDbId: number,
    claudeSessionId: string,
  ) => Effect.Effect<void, DatabaseError>;

  /** Set the current model for a session. */
  setSessionModel: (sessionDbId: number, model: string) => Effect.Effect<void>;

  /** Update token usage for a session. */
  updateTokenUsage: (
    sessionDbId: number,
    inputTokens: number,
    outputTokens: number,
  ) => Effect.Effect<void, DatabaseError>;

  /** Mark all running agent sessions as 'paused' in the database (called during shutdown). */
  saveAllSessionStates: () => Effect.Effect<void, DatabaseError>;

  /** Get the session DB ID for a managed subprocess. */
  getSessionDbId: (managedId: string) => Effect.Effect<number | null>;

  /**
   * Restore in-memory session map from DB on app startup.
   * Also marks stale 'running' sessions as 'paused'.
   */
  restoreSessionMap: () => Effect.Effect<void, DatabaseError>;

  /** Register a managed subprocess for session persistence tracking. */
  registerSession: (managedId: string, sessionDbId: number) => Effect.Effect<void>;

  /** Remove a managed subprocess from the session map. */
  removeSession: (managedId: string) => Effect.Effect<void>;
}

/** Context tag for the SessionPersistence service */
export class SessionPersistence extends Context.Tag("SessionPersistence")<
  SessionPersistence,
  SessionPersistenceService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const SessionPersistenceLive = Layer.effect(
  SessionPersistence,
  Effect.gen(function* () {
    const db = yield* Database;

    // ---------------------------------------------------------------------------
    // Internal state — lives for the lifetime of the service instance
    // ---------------------------------------------------------------------------
    /** Map of managedId → sessionDbId */
    const sessionMap = new Map<string, number>();
    /** Map of sessionDbId → current model (updated on each message_start or full assistant message) */
    const sessionModelMap = new Map<number, string>();
    /**
     * Track in-progress tool_use blocks so we can accumulate input_json_delta chunks.
     * Key: "sessionDbId:blockIndex" → { dbRowId, partialJson }
     */
    const pendingToolInputMap = new Map<string, { dbRowId: number; partialJson: string }>();
    /** Set of session IDs already marked has_file_changes — avoids redundant DB writes */
    const fileChangeMarked = new Set<number>();

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    const INSERT_MESSAGE_SQL =
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

    function markSessionHasFileChanges(
      sessionDbId: number,
    ): Effect.Effect<void, DatabaseError> {
      if (fileChangeMarked.has(sessionDbId)) return Effect.void;
      fileChangeMarked.add(sessionDbId);
      return db.execute(
        "UPDATE agent_sessions SET has_file_changes = 1 WHERE id = ?",
        sessionDbId,
      ).pipe(Effect.asVoid);
    }

    // ---------------------------------------------------------------------------
    // Service implementation
    // ---------------------------------------------------------------------------

    return {
      persistStreamEvent: (
        sessionDbId: number,
        event: StreamEvent,
        parentToolUseId?: string | null,
      ): Effect.Effect<void, DatabaseError> =>
        Effect.gen(function* () {
          const ptuid = parentToolUseId ?? null;

          switch (event.type) {
            case "message_start": {
              // Capture the actual model used for this assistant turn
              sessionModelMap.set(sessionDbId, event.message.model);
              break;
            }
            case "content_block_start": {
              const model = sessionModelMap.get(sessionDbId) ?? null;
              if (event.content_block.type === "text" && event.content_block.text) {
                yield* db.execute(
                  INSERT_MESSAGE_SQL,
                  sessionDbId, "assistant", event.content_block.text,
                  "text", null, null, ptuid, model,
                );
              } else if (
                event.content_block.type === "thinking" &&
                event.content_block.thinking
              ) {
                yield* db.execute(
                  INSERT_MESSAGE_SQL,
                  sessionDbId, "assistant", event.content_block.thinking,
                  "thinking", null, null, ptuid, model,
                );
              } else if (event.content_block.type === "tool_use") {
                const toolName = event.content_block.name;
                const result = yield* db.execute(
                  INSERT_MESSAGE_SQL,
                  sessionDbId, "assistant",
                  JSON.stringify(event.content_block.input),
                  "tool_call", toolName,
                  event.content_block.id ?? null, ptuid, model,
                );
                // Track row ID so input_json_delta can update it
                const key = `${sessionDbId}:${event.index}`;
                pendingToolInputMap.set(key, {
                  dbRowId: result.lastInsertRowid,
                  partialJson: "",
                });
                // Track file-modifying tools
                if (
                  toolName === "Write" ||
                  toolName === "Edit" ||
                  toolName === "NotebookEdit"
                ) {
                  yield* markSessionHasFileChanges(sessionDbId);
                }
              }
              break;
            }
            case "content_block_delta": {
              const model = sessionModelMap.get(sessionDbId) ?? null;
              if (
                event.delta.type === "thinking_delta" &&
                event.delta.thinking
              ) {
                yield* db.execute(
                  INSERT_MESSAGE_SQL,
                  sessionDbId, "assistant", event.delta.thinking,
                  "thinking_delta", null, null, ptuid, model,
                );
              } else if (
                event.delta.type === "input_json_delta" &&
                event.delta.partial_json
              ) {
                // Accumulate partial JSON and update the DB row
                const key = `${sessionDbId}:${event.index}`;
                const pending = pendingToolInputMap.get(key);
                if (pending) {
                  pending.partialJson += event.delta.partial_json;
                  try {
                    const parsed = JSON.parse(pending.partialJson);
                    yield* db.execute(
                      "UPDATE agent_messages SET content = ? WHERE id = ?",
                      JSON.stringify(parsed),
                      pending.dbRowId,
                    );
                  } catch {
                    // JSON not yet complete — will update on next delta or content_block_stop
                  }
                }
              } else if (
                event.delta.type === "text_delta" &&
                event.delta.text
              ) {
                yield* db.execute(
                  INSERT_MESSAGE_SQL,
                  sessionDbId, "assistant", event.delta.text,
                  "text_delta", null, null, ptuid, model,
                );
              }
              break;
            }
            case "content_block_stop": {
              // Finalize any pending tool input accumulation
              const stopKey = `${sessionDbId}:${event.index}`;
              const pending = pendingToolInputMap.get(stopKey);
              if (pending) {
                if (pending.partialJson) {
                  try {
                    const parsed = JSON.parse(pending.partialJson);
                    yield* db.execute(
                      "UPDATE agent_messages SET content = ? WHERE id = ?",
                      JSON.stringify(parsed),
                      pending.dbRowId,
                    );
                  } catch {
                    /* best effort */
                  }
                }
                pendingToolInputMap.delete(stopKey);
              }
              break;
            }
            case "tool_result": {
              yield* db.execute(
                INSERT_MESSAGE_SQL,
                sessionDbId, "tool", event.content,
                event.is_error ? "tool_error" : "tool_result",
                null, event.tool_use_id ?? null, ptuid, null,
              );
              break;
            }
            case "error": {
              yield* db.execute(
                INSERT_MESSAGE_SQL,
                sessionDbId, "system", event.error.message,
                "error", null, null, ptuid, null,
              );
              break;
            }
            case "system": {
              const sysEvent = event as StreamSystemEvent;
              if (sysEvent.subtype === "compact_boundary") {
                yield* db.execute(
                  INSERT_MESSAGE_SQL,
                  sessionDbId, "system", "compact_boundary",
                  "compact_divider", null, null, ptuid, null,
                );
              }
              break;
            }
            default:
              // Skip non-content events (message_stop, message_delta, ping, etc.)
              break;
          }
        }),

      persistSessionStatus: (
        managedId: string,
        status: string,
        sdkSessionId?: string,
      ): Effect.Effect<void, DatabaseError> =>
        Effect.gen(function* () {
          const dbId = sessionMap.get(managedId);
          if (!dbId) return;

          const extras: Record<string, unknown> = {
            ended_at: new Date().toISOString(),
          };
          if (status === "error") extras.subprocess_id = null;

          const keys = Object.keys(extras);
          const sets = ["status = ?", ...keys.map((k) => `${k} = ?`)];
          const values = [
            status,
            ...keys.map((k) => extras[k]),
            dbId,
          ];
          yield* db.execute(
            `UPDATE agent_sessions SET ${sets.join(", ")} WHERE id = ?`,
            ...values,
          );

          if (sdkSessionId) {
            yield* db.execute(
              "UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?",
              sdkSessionId,
              dbId,
            );
          }
        }),

      persistClaudeSessionId: (
        sessionDbId: number,
        claudeSessionId: string,
      ): Effect.Effect<void, DatabaseError> =>
        db.execute(
          "UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?",
          claudeSessionId,
          sessionDbId,
        ).pipe(Effect.asVoid),

      setSessionModel: (
        sessionDbId: number,
        model: string,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          sessionModelMap.set(sessionDbId, model);
        }),

      updateTokenUsage: (
        sessionDbId: number,
        inputTokens: number,
        outputTokens: number,
      ): Effect.Effect<void, DatabaseError> =>
        db.execute(
          "UPDATE agent_sessions SET input_tokens = ?, output_tokens = ? WHERE id = ?",
          inputTokens,
          outputTokens,
          sessionDbId,
        ).pipe(Effect.asVoid),

      saveAllSessionStates: (): Effect.Effect<void, DatabaseError> =>
        Effect.gen(function* () {
          // Mark running sessions as paused and clear subprocess_id
          yield* db.execute(
            "UPDATE agent_sessions SET status = 'paused', ended_at = datetime('now'), subprocess_id = NULL WHERE status = 'running'",
          );
          // Reset running phases — no subprocess can be executing them after shutdown
          yield* db.execute(
            "UPDATE phases SET status = 'pending' WHERE status = 'running'",
          );
          // Clear subprocess_id for completed/paused/error sessions
          yield* db.execute(
            "UPDATE agent_sessions SET subprocess_id = NULL WHERE status IN ('completed', 'paused', 'error') AND subprocess_id IS NOT NULL",
          );
        }),

      getSessionDbId: (managedId: string): Effect.Effect<number | null> =>
        Effect.sync(() => sessionMap.get(managedId) ?? null),

      restoreSessionMap: (): Effect.Effect<void, DatabaseError> =>
        Effect.gen(function* () {
          // Mark stale orchestrator sessions (execute with no subprocess) as error
          yield* db.execute(
            "UPDATE agent_sessions SET status = 'error', ended_at = datetime('now') WHERE status IN ('running', 'waiting') AND agent_type = 'execute' AND subprocess_id IS NULL AND phase_id IS NULL",
          );

          // Mark stale 'running' sessions as 'paused'
          yield* db.execute(
            "UPDATE agent_sessions SET status = 'paused', subprocess_id = NULL WHERE status = 'running'",
          );

          // Re-populate session map for paused sessions with subprocess_id
          const rows = yield* db.queryAll<{ id: number; subprocess_id: string }>(
            "SELECT id, subprocess_id FROM agent_sessions WHERE status = 'paused' AND subprocess_id IS NOT NULL",
          );
          for (const row of rows) {
            sessionMap.set(row.subprocess_id, row.id);
          }
        }),

      registerSession: (
        managedId: string,
        sessionDbId: number,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          sessionMap.set(managedId, sessionDbId);
        }),

      removeSession: (managedId: string): Effect.Effect<void> =>
        Effect.sync(() => {
          sessionMap.delete(managedId);
        }),
    };
  }),
);
