import type { StreamEvent, StreamSystemEvent } from "./types";
import { getDatabase } from "../db/database";

// Map of subprocess ID -> session DB ID for persistence
const sessionMap = new Map<string, number>();

// Map of session DB ID -> current model (updated on each message_start event or full assistant message)
const sessionModelMap = new Map<number, string>();

// Track in-progress tool_use blocks so we can accumulate input_json_delta chunks
// Key: "sessionDbId:blockIndex" -> { dbRowId, partialJson }
const pendingToolInputMap = new Map<string, { dbRowId: number; partialJson: string }>();

/**
 * Set the current model for a session (called from subprocess-manager for full assistant messages).
 */
export function setSessionModel(sessionDbId: number, model: string): void {
  sessionModelMap.set(sessionDbId, model);
}

/**
 * Register a subprocess for session persistence tracking.
 */
export function registerSessionPersistence(
  subprocessId: string,
  sessionDbId: number,
): void {
  sessionMap.set(subprocessId, sessionDbId);
}

/**
 * Get the session DB ID for a subprocess (used by the subprocess manager for persistence).
 */
export function getSessionDbId(subprocessId: string): number | undefined {
  return sessionMap.get(subprocessId);
}

/**
 * Find the active subprocess ID for a given DB session ID.
 * Returns the subprocess ID if it's still in the session map, or undefined.
 */
export function getSubprocessIdForSession(sessionDbId: number): string | undefined {
  for (const [subprocessId, dbId] of sessionMap) {
    if (dbId === sessionDbId) return subprocessId;
  }
  return undefined;
}

/**
 * Persist a stream event to the agent_messages table.
 * Only persists content-bearing events (text, tool calls, tool results, errors).
 */
export function persistStreamEvent(
  sessionDbId: number,
  event: StreamEvent,
  parentToolUseId?: string | null,
): number | null {
  try {
    const db = getDatabase();
    const insert = db.prepare(
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );

    const ptuid = parentToolUseId ?? null;
    let result: { lastInsertRowid: number | bigint } | undefined;

    switch (event.type) {
      case "message_start": {
        // Capture the actual model used for this assistant turn
        sessionModelMap.set(sessionDbId, event.message.model);
        break;
      }
      case "content_block_start": {
        const model = sessionModelMap.get(sessionDbId) ?? null;
        if (event.content_block.type === "text" && event.content_block.text) {
          result = insert.run(
            sessionDbId,
            "assistant",
            event.content_block.text,
            "text",
            null,
            null,
            ptuid,
            model,
          ) as { lastInsertRowid: number | bigint };
        } else if (event.content_block.type === "thinking" && event.content_block.thinking) {
          result = insert.run(
            sessionDbId,
            "assistant",
            event.content_block.thinking,
            "thinking",
            null,
            null,
            ptuid,
            model,
          ) as { lastInsertRowid: number | bigint };
        } else if (event.content_block.type === "tool_use") {
          const toolName = event.content_block.name;
          result = insert.run(
            sessionDbId,
            "assistant",
            JSON.stringify(event.content_block.input),
            "tool_call",
            toolName,
            event.content_block.id ?? null,
            ptuid,
            model,
          ) as { lastInsertRowid: number | bigint };

          // Track row ID so input_json_delta can update it
          const key = `${sessionDbId}:${event.index}`;
          pendingToolInputMap.set(key, {
            dbRowId: Number(result.lastInsertRowid),
            partialJson: "",
          });

          // Track file-modifying tools
          if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
            markSessionHasFileChanges(sessionDbId);
          }
        }
        break;
      }
      case "content_block_delta": {
        const model = sessionModelMap.get(sessionDbId) ?? null;
        if (event.delta.type === "thinking_delta" && event.delta.thinking) {
          result = insert.run(
            sessionDbId,
            "assistant",
            event.delta.thinking,
            "thinking_delta",
            null,
            null,
            ptuid,
            model,
          ) as { lastInsertRowid: number | bigint };
        } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
          // Accumulate partial JSON for tool_use input and update the DB row
          const key = `${sessionDbId}:${event.index}`;
          const pending = pendingToolInputMap.get(key);
          if (pending) {
            pending.partialJson += event.delta.partial_json;
            try {
              const parsed = JSON.parse(pending.partialJson);
              db.prepare("UPDATE agent_messages SET content = ? WHERE id = ?")
                .run(JSON.stringify(parsed), pending.dbRowId);
            } catch {
              // JSON not yet complete — will update on next delta or content_block_stop
            }
          }
        } else if (event.delta.type === "text_delta" && event.delta.text) {
          result = insert.run(
            sessionDbId,
            "assistant",
            event.delta.text,
            "text_delta",
            null,
            null,
            ptuid,
            model,
          ) as { lastInsertRowid: number | bigint };
        }
        break;
      }
      case "content_block_stop": {
        // Finalize any pending tool input accumulation
        const stopKey = `${sessionDbId}:${event.index}`;
        const pending = pendingToolInputMap.get(stopKey);
        if (pending) {
          // Final update with whatever JSON we accumulated
          if (pending.partialJson) {
            try {
              const parsed = JSON.parse(pending.partialJson);
              db.prepare("UPDATE agent_messages SET content = ? WHERE id = ?")
                .run(JSON.stringify(parsed), pending.dbRowId);
            } catch { /* best effort */ }
          }
          pendingToolInputMap.delete(stopKey);
        }
        break;
      }
      case "tool_result": {
        result = insert.run(
          sessionDbId,
          "tool",
          event.content,
          event.is_error ? "tool_error" : "tool_result",
          null,
          event.tool_use_id ?? null,
          ptuid,
          null,
        ) as { lastInsertRowid: number | bigint };
        break;
      }
      case "error": {
        result = insert.run(sessionDbId, "system", event.error.message, "error", null, null, ptuid, null) as { lastInsertRowid: number | bigint };
        break;
      }
      case "system": {
        const sysEvent = event as StreamSystemEvent;
        if (sysEvent.subtype === "compact_boundary") {
          result = insert.run(
            sessionDbId, "system", "compact_boundary", "compact_divider", null, null, ptuid, null,
          ) as { lastInsertRowid: number | bigint };
        }
        break;
      }
      default:
        // Skip non-content events (message_stop, message_delta, ping, etc.)
        break;
    }
    return result ? Number(result.lastInsertRowid) : null;
  } catch {
    // Best-effort persistence — don't crash the bridge
    return null;
  }
}

/**
 * Persist a Claude session ID to the agent_sessions table.
 */
export function persistClaudeSessionId(
  sessionDbId: number,
  claudeSessionId: string,
): void {
  try {
    const db = getDatabase();
    db.prepare(
      "UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?",
    ).run(claudeSessionId, sessionDbId);
  } catch {
    // Best-effort persistence
  }
}

import { broadcast, DB_UPDATED_CHANNEL } from "./broadcast";

export type DbEntity = "feature" | "phase" | "plan" | "agent_session";

export interface DbUpdateEvent {
  entity: DbEntity;
  featureId: number;
}

/**
 * Notify all renderer windows that data changed in the DB.
 * The renderer listens for this and invalidates TanStack Query caches.
 */
export function notifyDbUpdated(entity: DbEntity, featureId: number): void {
  broadcast(DB_UPDATED_CHANNEL, { entity, featureId } satisfies DbUpdateEvent);
}

/**
 * Find subprocess IDs that are mapped to any of the given session DB IDs.
 * Used to stop running subprocesses when deleting a feature.
 */
export function getSubprocessIdsForSessionDbIds(
  sessionDbIds: number[],
): string[] {
  const result: string[] = [];
  const idSet = new Set(sessionDbIds);
  for (const [subprocessId, sessionDbId] of sessionMap.entries()) {
    if (idSet.has(sessionDbId)) {
      result.push(subprocessId);
    }
  }
  return result;
}

/**
 * Restore the in-memory sessionMap from the database on app startup.
 * Also marks any sessions that claim to be 'running' as 'paused' — after an app
 * restart no subprocess can actually be running, and leaving them as 'running'
 * causes the renderer to try sending messages to dead processes.
 */
export function restoreSessionMap(): void {
  try {
    const db = getDatabase();
    // Mark stale orchestrator sessions (execute with no subprocess) as error — they're
    // just in-memory loops, not resumable, and leaving them as 'running' or 'paused' blocks the UI.
    const staleOrchestrators = db.prepare(
      "SELECT id, feature_id FROM agent_sessions WHERE status IN ('running', 'waiting') AND agent_type = 'execute' AND subprocess_id IS NULL AND phase_id IS NULL",
    ).all() as Array<{ id: number; feature_id: number }>;
    if (staleOrchestrators.length > 0) {
      console.log(`[startup-cleanup] Marking ${staleOrchestrators.length} stale orchestrator sessions as error:`, staleOrchestrators.map((s) => `session ${s.id} (feature ${s.feature_id})`).join(", "));
      db.prepare(
        "UPDATE agent_sessions SET status = 'error', ended_at = datetime('now') WHERE status IN ('running', 'waiting') AND agent_type = 'execute' AND subprocess_id IS NULL AND phase_id IS NULL",
      ).run();
    }

    // Mark stale 'running' sessions as 'paused' — they can't be running after restart
    const staleSessions = db.prepare("SELECT id, feature_id, agent_type, phase_id FROM agent_sessions WHERE status = 'running'").all() as Array<{ id: number; feature_id: number; agent_type: string; phase_id: number | null }>;
    if (staleSessions.length > 0) {
      console.log(`[startup-cleanup] Resetting ${staleSessions.length} running sessions to paused:`, staleSessions.map((s) => `session ${s.id} (${s.agent_type}, feature ${s.feature_id}, phase ${s.phase_id})`).join(", "));
    }
    // Preserve pending_plan_approval so the approval bar still shows after restart.
    db.prepare(
      "UPDATE agent_sessions SET status = 'paused', subprocess_id = NULL WHERE status = 'running'",
    ).run();
    // Re-populate session map for paused sessions with subprocess_id (for event routing)
    const rows = db
      .prepare(
        "SELECT id, subprocess_id FROM agent_sessions WHERE status = 'paused' AND subprocess_id IS NOT NULL",
      )
      .all() as Array<{ id: number; subprocess_id: string }>;
    for (const row of rows) {
      sessionMap.set(row.subprocess_id, row.id);
    }
  } catch {
    // Best-effort: database may not be ready yet
  }
}

// Set of session IDs already marked — avoids redundant DB writes
const fileChangeMarked = new Set<number>();

function markSessionHasFileChanges(sessionDbId: number): void {
  if (fileChangeMarked.has(sessionDbId)) return;
  fileChangeMarked.add(sessionDbId);
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sessionDbId) as { feature_id: number } | undefined;
    db.prepare("UPDATE agent_sessions SET has_file_changes = 1 WHERE id = ?").run(sessionDbId);
    if (row) notifyDbUpdated("agent_session", row.feature_id);
  } catch { /* best-effort */ }
}

export { DB_UPDATED_CHANNEL } from "./broadcast";
