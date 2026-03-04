/**
 * Plan and PRD approval helpers used by the MCP show_plan / show_prd tools.
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

  // 0. Check for a stored approval result (set when user approved while agent was paused/completed)
  if (sDbId) {
    try {
      const db2 = getDatabase();
      const stored = db2.prepare("SELECT plan_approval_result FROM agent_sessions WHERE id = ?").get(sDbId) as { plan_approval_result: string | null } | undefined;
      if (stored?.plan_approval_result) {
        const result = JSON.parse(stored.plan_approval_result) as { approved: boolean; feedback?: string };
        db2.prepare("UPDATE agent_sessions SET plan_approval_result = NULL, pending_plan_approval = NULL WHERE id = ?").run(sDbId);
        const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
        if (row) notifyDbUpdated("agent_session", row.feature_id);
        return result;
      }
    } catch (e) { console.warn("[plan-approval] Failed to check stored approval:", e); }
  }

  // 1. Emit a synthetic tool_call block so the plan renders in the message list.
  const syntheticToolUseId = `show_plan_${Date.now()}`;
  const toolArgs = JSON.stringify({ plan: planMarkdown });
  const toolName = "mcp__cadence-plan__show_plan";

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
        reject(new Error("Plan approval timeout (5h)"));
      }, 5 * 60 * 60 * 1000);

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

/**
 * Block until the user approves or rejects a PRD.
 * Mirrors waitForPlanApproval but uses prd-specific DB columns and event names.
 */
export async function waitForPrdApproval(
  subprocessId: string,
  prdMarkdown: string,
): Promise<{ approved: boolean; feedback?: string }> {
  const sDbId = getSessionDbId(subprocessId);
  let featureIdForNotify: number | null = null;

  // 0. Check for a stored approval result (set when user approved while agent was paused/completed)
  if (sDbId) {
    try {
      const db2 = getDatabase();
      const stored = db2.prepare("SELECT prd_approval_result FROM agent_sessions WHERE id = ?").get(sDbId) as { prd_approval_result: string | null } | undefined;
      if (stored?.prd_approval_result) {
        const result = JSON.parse(stored.prd_approval_result) as { approved: boolean; feedback?: string };
        db2.prepare("UPDATE agent_sessions SET prd_approval_result = NULL, pending_prd_approval = NULL WHERE id = ?").run(sDbId);
        const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
        if (row) notifyDbUpdated("agent_session", row.feature_id);
        return result;
      }
    } catch (e) { console.warn("[prd-approval] Failed to check stored approval:", e); }
  }

  // 1. Emit a synthetic tool_call block so the PRD renders in the message list.
  const syntheticToolUseId = `show_prd_${Date.now()}`;
  const toolArgs = JSON.stringify({ prd: prdMarkdown });
  const toolName = "mcp__cadence-prd__show_prd";

  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(sDbId, "assistant", toolArgs, "tool_call", toolName, syntheticToolUseId);

      const row2 = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row2) notifyDbUpdated("agent_session", row2.feature_id);
    } catch (err) {
      console.error("[prd-approval] Failed to emit synthetic show_prd block:", err);
    }
  }

  // 2. Set pending_prd_approval in DB to trigger the approval bar UI
  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE agent_sessions SET pending_prd_approval = ? WHERE id = ?")
        .run(JSON.stringify({ prd: prdMarkdown }), sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch (e) { console.warn("[prd-approval] best-effort op failed:", e); }
  }

  // 3. Wait for user response
  const cleanup = () => {
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_prd_approval = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[prd-approval] best-effort op failed:", e); }
    }
  };

  try {
    const result = await new Promise<{ approved: boolean; feedback?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        questionEmitter.removeAllListeners(`prd-approval:${subprocessId}`);
        reject(new Error("PRD approval timeout (5h)"));
      }, 5 * 60 * 60 * 1000);

      questionEmitter.once(
        `prd-approval:${subprocessId}`,
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
