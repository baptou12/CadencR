/**
 * Shared DB helpers for agent code — eliminates the repeated
 * try { db.prepare().run() } catch {} + notifyDbUpdated() pattern.
 */
import { getDatabase } from "../db/database";
import { notifyDbUpdated } from "./ipc-bridge";

/**
 * Update an agent session's fields. Automatically calls notifyDbUpdated.
 * Silently catches errors (best-effort persistence).
 */
export function updateSession(
  sessionDbId: number,
  fields: Record<string, unknown>,
  featureId?: number,
): void {
  try {
    const db = getDatabase();
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClauses = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => fields[k]);
    db.prepare(`UPDATE agent_sessions SET ${setClauses} WHERE id = ?`).run(
      ...values,
      sessionDbId,
    );
    if (featureId !== undefined) {
      notifyDbUpdated("agent_session", featureId);
    }
  } catch {
    // Best-effort persistence
  }
}

/**
 * Insert an agent message. Returns the message DB ID or null on failure.
 */
export function insertMessage(
  sessionDbId: number,
  msg: {
    role: string;
    content: string;
    messageType: string;
    toolName?: string | null;
    toolUseId?: string | null;
    parentToolUseId?: string | null;
  },
): number | null {
  try {
    const db = getDatabase();
    const result = db
      .prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        sessionDbId,
        msg.role,
        msg.content,
        msg.messageType,
        msg.toolName ?? null,
        msg.toolUseId ?? null,
        msg.parentToolUseId ?? null,
      );
    return Number(result.lastInsertRowid);
  } catch {
    return null;
  }
}

/**
 * Look up the feature_id for a session. Used when we need to notify the renderer.
 */
export function getSessionFeatureId(sessionDbId: number): number | undefined {
  try {
    const db = getDatabase();
    const row = db
      .prepare("SELECT feature_id FROM agent_sessions WHERE id = ?")
      .get(sessionDbId) as { feature_id: number } | undefined;
    return row?.feature_id;
  } catch {
    return undefined;
  }
}
