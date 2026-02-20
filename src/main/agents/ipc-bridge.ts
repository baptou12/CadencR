import type { ManagedSubprocess } from "./subprocess-manager";
import type { AgentType, StreamEvent, StreamSystemEvent } from "./types";
import { getDatabase } from "../db/database";
import { AGENT_EVENT_CHANNEL } from "./broadcast";

/**
 * Bridge subprocess events to the renderer.
 * With the SDK-based subprocess manager, event broadcasting is handled
 * internally by the subprocess manager. This function now only sets up
 * persistence of session IDs and messages.
 */
export function bridgeSubprocessToRenderer(
  managed: ManagedSubprocess,
  agentType: AgentType,
  sessionDbId?: number,
): void {
  // The SDK-based subprocess manager broadcasts events directly.
  // This function is kept for backward compatibility but is now a no-op
  // for event broadcasting. Session persistence is handled separately.

  if (sessionDbId) {
    // Register this session for persistence tracking
    registerSessionPersistence(managed.id, sessionDbId);
  }
}

// Map of subprocess ID -> session DB ID for persistence
const sessionMap = new Map<string, number>();

function registerSessionPersistence(
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
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );

    const ptuid = parentToolUseId ?? null;
    let result: { lastInsertRowid: number | bigint } | undefined;

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text" && event.content_block.text) {
          result = insert.run(
            sessionDbId,
            "assistant",
            event.content_block.text,
            "text",
            null,
            null,
            ptuid,
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
          ) as { lastInsertRowid: number | bigint };

          // Track file-modifying tools
          if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit") {
            markSessionHasFileChanges(sessionDbId);
          }
        }
        break;
      }
      case "content_block_delta": {
        if (event.delta.type === "text_delta" && event.delta.text) {
          result = insert.run(
            sessionDbId,
            "assistant",
            event.delta.text,
            "text_delta",
            null,
            null,
            ptuid,
          ) as { lastInsertRowid: number | bigint };
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
        ) as { lastInsertRowid: number | bigint };
        break;
      }
      case "error": {
        result = insert.run(sessionDbId, "system", event.error.message, "error", null, null, ptuid) as { lastInsertRowid: number | bigint };
        break;
      }
      case "system": {
        const sysEvent = event as StreamSystemEvent;
        if (sysEvent.subtype === "compact_boundary") {
          result = insert.run(
            sessionDbId, "system", "compact_boundary", "compact_divider", null, null, ptuid,
          ) as { lastInsertRowid: number | bigint };
        }
        break;
      }
      default:
        // Skip non-content events (message_start, message_stop, message_delta)
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
    // Mark stale 'running' sessions as 'paused' — they can't be running after restart
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

export { AGENT_EVENT_CHANNEL, DB_UPDATED_CHANNEL } from "./broadcast";
