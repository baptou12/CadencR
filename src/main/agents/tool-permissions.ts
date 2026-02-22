/**
 * Tool permission handling for the canUseTool SDK callback.
 * Extracted from subprocess-manager.ts — handles AskUserQuestion,
 * ExitPlanMode, and smart permission resolution.
 */

import { getDatabase } from "../db/database";
import { getSessionDbId, notifyDbUpdated } from "./session-persistence";
import { resolvePermission, appendToSettingsLocal } from "./permissions";
import { broadcast, ASK_USER_QUESTION_CHANNEL, TOOL_PERMISSION_CHANNEL } from "./broadcast";
import type { ManagedSubprocess } from "./subprocess-manager";
import EventEmitter from "node:events";

// Global event emitter for question/answer coordination
export const questionEmitter = new EventEmitter();

type CanUseToolResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown> }
  | { behavior: "deny"; message: string };

/**
 * Create the canUseTool callback for an SDK query.
 * Handles smart permission resolution, AskUserQuestion, and ExitPlanMode.
 */
export function createCanUseToolHandler(
  managed: ManagedSubprocess,
): (toolName: string, input: Record<string, unknown>) => Promise<CanUseToolResult> {
  return async (toolName: string, input: Record<string, unknown>): Promise<CanUseToolResult> => {
    // --- Smart permission resolution ---
    if (managed.worktreePath && toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
      const permResult = resolvePermission(
        toolName,
        input,
        managed.worktreePath,
        managed.cachedPermissions,
      );

      if (permResult === "allow") {
        return { behavior: "allow" as const, updatedInput: input };
      }

      if ("denied" in permResult) {
        return { behavior: "deny" as const, message: permResult.reason };
      }

      // needs_prompt — ask the user
      if ("needs_prompt" in permResult) {
        try {
          const decision = await requestToolPermission(managed.id, {
            toolName,
            input,
            description: permResult.description,
            pattern: permResult.pattern,
          });

          if (decision.decision === "allow_once") {
            managed.cachedPermissions.add(permResult.pattern);
            return { behavior: "allow" as const, updatedInput: input };
          }

          if (decision.decision === "allow_future") {
            managed.cachedPermissions.add(permResult.pattern);
            try {
              appendToSettingsLocal(managed.worktreePath!, permResult.pattern);
            } catch (err) {
              console.error("[tool-permissions] Failed to write settings.local.json:", err);
            }
            return { behavior: "allow" as const, updatedInput: input };
          }

          // deny
          return {
            behavior: "deny" as const,
            message: decision.feedback || "User denied this tool call.",
          };
        } catch (err) {
          console.error("[tool-permissions] Permission prompt failed:", err);
          return {
            behavior: "deny" as const,
            message: "Permission prompt timed out or failed.",
          };
        }
      }
    }

    if (toolName === "AskUserQuestion") {
      return handleAskUserQuestion(managed, input);
    }

    if (toolName === "ExitPlanMode") {
      return handleExitPlanMode(managed, input);
    }

    // Allow all other tools
    return { behavior: "allow" as const, updatedInput: input };
  };
}

// ---------------------------------------------------------------------------
// AskUserQuestion handler
// ---------------------------------------------------------------------------

async function handleAskUserQuestion(
  managed: ManagedSubprocess,
  input: Record<string, unknown>,
): Promise<CanUseToolResult> {
  const sDbId = getSessionDbId(managed.id);
  let featureIdForNotify: number | null = null;
  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE agent_sessions SET pending_questions = ? WHERE id = ?")
        .run(JSON.stringify(input), sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
  }

  try {
    const answers = await requestUserAnswers(managed.id, input);

    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
    }

    return {
      behavior: "allow" as const,
      updatedInput: { ...input, answers },
    };
  } catch (error) {
    console.error("[tool-permissions] Failed to get user answers:", error);
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
    }
    return {
      behavior: "allow" as const,
      updatedInput: { ...input, answers: {} },
    };
  }
}

// ---------------------------------------------------------------------------
// ExitPlanMode handler
// ---------------------------------------------------------------------------

async function handleExitPlanMode(
  managed: ManagedSubprocess,
  input: Record<string, unknown>,
): Promise<CanUseToolResult> {
  const sDbId = getSessionDbId(managed.id);
  let featureIdForNotify: number | null = null;
  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
        .run(JSON.stringify(input), sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
  }

  try {
    const result = await new Promise<{ approved: boolean; feedback?: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          questionEmitter.removeAllListeners(`plan-approval:${managed.id}`);
          reject(new Error("Plan approval timeout (5h)"));
        },
        5 * 60 * 60 * 1000,
      );

      questionEmitter.once(
        `plan-approval:${managed.id}`,
        (response: { approved: boolean; feedback?: string }) => {
          clearTimeout(timeout);
          resolve(response);
        },
      );
    });

    if (result.approved) {
      if (managed.query) {
        await managed.query.setPermissionMode("acceptEdits");
      }
      if (sDbId) {
        try {
          const db2 = getDatabase();
          db2.prepare("UPDATE agent_sessions SET permission_mode = 'acceptEdits', pending_plan_approval = NULL WHERE id = ?")
            .run(sDbId);
          if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
        } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
      }
      return { behavior: "allow" as const, updatedInput: input };
    } else {
      if (sDbId) {
        try {
          const db2 = getDatabase();
          db2.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(sDbId);
          if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
        } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
      }
      return {
        behavior: "deny" as const,
        message: result.feedback || "User requested changes to the plan.",
      };
    }
  } catch (error) {
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
    }
    console.error("[tool-permissions] Plan approval failed:", error);
    return { behavior: "deny" as const, message: "Plan approval timed out or failed. Please re-submit the plan." };
  }
}

// ---------------------------------------------------------------------------
// IPC request helpers
// ---------------------------------------------------------------------------

/**
 * Request user answers to AskUserQuestion from the renderer.
 */
export async function requestUserAnswers(
  subprocessId: string,
  questions: Record<string, unknown>,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        questionEmitter.removeAllListeners(`answer:${subprocessId}`);
        reject(new Error("User answer timeout (15m)"));
      },
      15 * 60 * 1000,
    );

    questionEmitter.once(
      `answer:${subprocessId}`,
      (answers: Record<string, string>) => {
        clearTimeout(timeout);
        resolve(answers);
      },
    );

    broadcast(ASK_USER_QUESTION_CHANNEL, { subprocessId, questions });
  });
}

/**
 * Request permission from the user for a tool call.
 */
async function requestToolPermission(
  subprocessId: string,
  permissionRequest: {
    toolName: string;
    input: Record<string, unknown>;
    description: string;
    pattern: string;
  },
): Promise<{ decision: "allow_once" | "allow_future" | "deny"; feedback?: string }> {
  const sDbId = getSessionDbId(subprocessId);
  let featureIdForNotify: number | null = null;
  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE agent_sessions SET pending_permission = ? WHERE id = ?")
        .run(JSON.stringify(permissionRequest), sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
  }

  try {
    const result = await new Promise<{ decision: "allow_once" | "allow_future" | "deny"; feedback?: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          questionEmitter.removeAllListeners(`permission:${subprocessId}`);
          reject(new Error("Tool permission timeout (15m)"));
        },
        15 * 60 * 1000,
      );

      questionEmitter.once(
        `permission:${subprocessId}`,
        (response: { decision: "allow_once" | "allow_future" | "deny"; feedback?: string }) => {
          clearTimeout(timeout);
          resolve(response);
        },
      );

      broadcast(TOOL_PERMISSION_CHANNEL, { subprocessId, ...permissionRequest });
    });

    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_permission = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
    }

    return result;
  } catch (error) {
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_permission = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
    }
    throw error;
  }
}

/**
 * Submit a tool permission decision from the renderer.
 */
export function submitToolPermission(
  subprocessId: string,
  decision: "allow_once" | "allow_future" | "deny",
  feedback?: string,
): void {
  questionEmitter.emit(`permission:${subprocessId}`, { decision, feedback });
}

/**
 * Submit user answers for a pending AskUserQuestion.
 */
export function submitUserAnswers(
  subprocessId: string,
  answers: Record<string, string>,
): void {
  const sessionDbId = getSessionDbId(subprocessId);
  if (sessionDbId) {
    try {
      const lines = Object.entries(answers).map(([q, a]) => `**${q}**\n${a}`);
      const content = lines.join("\n\n");
      const db = getDatabase();
      db.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
      ).run(sessionDbId, "user", content, "user_message", null);
      const fid = getFeatureIdForSubprocess(subprocessId);
      if (fid != null) notifyDbUpdated("agent_session", fid);
    } catch {
      // Best-effort persistence
    }
  }

  questionEmitter.emit(`answer:${subprocessId}`, answers);
}

/**
 * Submit a plan approval or rejection for a pending ExitPlanMode tool call.
 * Returns { success: true } if a listener was waiting, or { success: false, error } if not.
 */
export function submitPlanApproval(
  subprocessId: string,
  approved: boolean,
  feedback?: string,
): { success: boolean; error?: string } {
  // Check if anyone is actually listening for this approval
  const eventName = `plan-approval:${subprocessId}`;
  const hasListener = questionEmitter.listenerCount(eventName) > 0;

  if (!hasListener) {
    // Lazy import to avoid circular dependency (subprocess-manager imports tool-permissions)
    let proc: unknown | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sm = require("./subprocess-manager");
      proc = sm.getActiveProcess(subprocessId);
    } catch {
      proc = undefined;
    }
    if (!proc) {
      // Clear stale pending_plan_approval from DB
      const sessionDbId = getSessionDbId(subprocessId);
      if (sessionDbId) {
        try {
          const db = getDatabase();
          db.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(sessionDbId);
          const fid = getFeatureIdForSubprocess(subprocessId);
          if (fid != null) notifyDbUpdated("agent_session", fid);
        } catch { /* best-effort */ }
      }
      return { success: false, error: "Agent is no longer running. Please restart the agent to continue." };
    }
    // Process exists but no listener — could be a transient state, but still suspicious
    return { success: false, error: "Agent is not waiting for plan approval. It may have timed out or been interrupted." };
  }

  if (!approved && feedback) {
    const sessionDbId = getSessionDbId(subprocessId);
    if (sessionDbId) {
      try {
        const content = `**Plan feedback:**\n${feedback}`;
        const db = getDatabase();
        db.prepare(
          "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
        ).run(sessionDbId, "user", content, "user_message", null);
        const fid = getFeatureIdForSubprocess(subprocessId);
        if (fid != null) notifyDbUpdated("agent_session", fid);
      } catch {
        // Best-effort persistence
      }
    }
  }

  questionEmitter.emit(eventName, { approved, feedback });
  return { success: true };
}

// Helper — resolve feature ID for a subprocess (for DB notifications)
function getFeatureIdForSubprocess(subprocessId: string): number | null {
  const sessionDbId = getSessionDbId(subprocessId);
  if (!sessionDbId) return null;
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sessionDbId) as { feature_id: number } | undefined;
    return row?.feature_id ?? null;
  } catch { return null; }
}
