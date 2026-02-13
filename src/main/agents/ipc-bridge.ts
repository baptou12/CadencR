import type { ManagedSubprocess } from "./subprocess-manager";
import type { AgentType, StreamEvent } from "./types";
import { getDatabase } from "../db/database";

const AGENT_EVENT_CHANNEL = "agent:event";

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
): void {
  try {
    const db = getDatabase();
    const insert = db.prepare(
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
    );

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text" && event.content_block.text) {
          insert.run(
            sessionDbId,
            "assistant",
            event.content_block.text,
            "text",
            null,
          );
        } else if (event.content_block.type === "tool_use") {
          insert.run(
            sessionDbId,
            "assistant",
            JSON.stringify(event.content_block.input),
            "tool_call",
            event.content_block.name,
          );
        }
        break;
      }
      case "content_block_delta": {
        if (event.delta.type === "text_delta" && event.delta.text) {
          insert.run(
            sessionDbId,
            "assistant",
            event.delta.text,
            "text_delta",
            null,
          );
        }
        break;
      }
      case "tool_result": {
        insert.run(
          sessionDbId,
          "tool",
          event.content,
          event.is_error ? "tool_error" : "tool_result",
          null,
        );
        break;
      }
      case "error": {
        insert.run(sessionDbId, "system", event.error.message, "error", null);
        break;
      }
      default:
        // Skip non-content events (message_start, message_stop, message_delta, system)
        break;
    }
  } catch {
    // Best-effort persistence — don't crash the bridge
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

const DB_UPDATED_CHANNEL = "db:updated";

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
  const { BrowserWindow } = require("electron") as typeof import("electron");
  const event: DbUpdateEvent = { entity, featureId };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(DB_UPDATED_CHANNEL, event);
    }
  }
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

export { AGENT_EVENT_CHANNEL, DB_UPDATED_CHANNEL };
