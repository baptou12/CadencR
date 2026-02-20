/**
 * Plan approval helper used by the MCP show_plan tool.
 * Extracted from subprocess-manager.ts.
 */

import { getDatabase } from "../db/database";
import { getSessionDbId, notifyDbUpdated } from "./session-persistence";
import { questionEmitter } from "./tool-permissions";

/**
 * Block until the user approves or rejects a plan.
 * Sets `pending_plan_approval` in the DB to trigger the approval UI,
 * waits for the user response via questionEmitter, and cleans up.
 *
 * Returns `{ approved, feedback }`. Throws on timeout.
 */
export async function waitForPlanApproval(
  subprocessId: string,
  planMarkdown: string,
): Promise<{ approved: boolean; feedback?: string }> {
  const sDbId = getSessionDbId(subprocessId);
  let featureIdForNotify: number | null = null;

  // 1. Emit a synthetic tool_call block so the plan renders in the message list.
  const syntheticToolUseId = `show_plan_${Date.now()}`;
  const toolArgs = JSON.stringify({ plan: planMarkdown });
  const toolName = "mcp__productdevr-plan__show_plan";

  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(sDbId, "assistant", toolArgs, "tool_call", toolName, syntheticToolUseId);

      const row2 = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row2) notifyDbUpdated("agent_session", row2.feature_id);
    } catch (err) {
      console.error("[plan-approval] Failed to emit synthetic show_plan block:", err);
    }
  }

  // 2. Set pending_plan_approval in DB to trigger the approval bar UI
  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
        .run(JSON.stringify({ plan: planMarkdown }), sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch (e) { console.warn("[plan-approval] best-effort op failed:", e); }
  }

  // 3. Wait for user response
  const cleanup = () => {
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[plan-approval] best-effort op failed:", e); }
    }
  };

  try {
    const result = await new Promise<{ approved: boolean; feedback?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        questionEmitter.removeAllListeners(`plan-approval:${subprocessId}`);
        reject(new Error("Plan approval timeout (15m)"));
      }, 15 * 60 * 1000);

      questionEmitter.once(
        `plan-approval:${subprocessId}`,
        (response: { approved: boolean; feedback?: string }) => {
          clearTimeout(timeout);
          resolve(response);
        },
      );
    });

    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}
