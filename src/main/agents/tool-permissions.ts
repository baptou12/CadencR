/**
 * Tool permission handling for the canUseTool SDK callback.
 * Extracted from subprocess-manager.ts — handles AskUserQuestion,
 * ExitPlanMode, and smart permission resolution.
 *
 * The EventEmitter-based coordination (questionEmitter) has been replaced
 * by the ToolPermissions Effect service, accessed via getAppRuntime().
 */

import * as fs from "node:fs";
import { Effect } from "effect";
import { getDatabase } from "../db/database";
import { getSessionDbId, notifyDbUpdated } from "./effect-helpers";
import { resolvePermission, appendToSettingsLocal } from "./permissions";
import { getAppRuntime } from "../effect/app-runtime-ref";
import { ToolPermissions } from "../effect/services/ToolPermissions";
import type { ManagedSubprocess } from "./types";

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

  // Check for a stored approval result (set when user approved while agent was paused/completed)
  if (sDbId) {
    try {
      const db2 = getDatabase();
      const stored = db2.prepare("SELECT plan_approval_result FROM agent_sessions WHERE id = ?").get(sDbId) as { plan_approval_result: string | null } | undefined;
      if (stored?.plan_approval_result) {
        const result = JSON.parse(stored.plan_approval_result) as { approved: boolean; feedback?: string };
        db2.prepare("UPDATE agent_sessions SET plan_approval_result = NULL, pending_plan_approval = NULL WHERE id = ?").run(sDbId);
        const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
        if (row) notifyDbUpdated("agent_session", row.feature_id);

        if (result.approved) {
          if (managed.query) await managed.query.setPermissionMode("acceptEdits");
          if (sDbId) {
            try {
              const db3 = getDatabase();
              db3.prepare("UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE id = ?").run(sDbId);
            } catch { /* best-effort */ }
          }
          return { behavior: "allow" as const, updatedInput: input };
        } else {
          return { behavior: "deny" as const, message: result.feedback || "User requested changes to the plan." };
        }
      }
    } catch (e) { console.warn("[tool-permissions] Failed to check stored approval:", e); }
  }

  // Read plan content from the last Write to .claude/plans/ in this session's messages
  let planMarkdown: string | undefined;
  if (sDbId) {
    try {
      const db2 = getDatabase();
      const planMsg = db2.prepare(
        "SELECT content FROM agent_messages WHERE session_id = ? AND message_type = 'tool_call' AND tool_name = 'Write' AND content LIKE '%/.claude/plans/%' ORDER BY id DESC LIMIT 1",
      ).get(sDbId) as { content: string } | undefined;
      if (planMsg) {
        const parsed = JSON.parse(planMsg.content) as { file_path?: string };
        if (parsed.file_path) {
          try { planMarkdown = await fs.promises.readFile(parsed.file_path, "utf-8"); } catch { /* file may not exist */ }
        }
      }
    } catch (e) { console.warn("[tool-permissions] Failed to read plan file:", e); }
  }

  // Insert a synthetic show_plan block so the plan renders in the message list
  if (sDbId && planMarkdown) {
    try {
      const db2 = getDatabase();
      const syntheticToolUseId = `show_plan_${Date.now()}`;
      const toolArgs = JSON.stringify({ plan: planMarkdown });
      db2.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(sDbId, "assistant", toolArgs, "tool_call", "mcp__cadence-plan__show_plan", syntheticToolUseId);
      const row2 = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row2) notifyDbUpdated("agent_session", row2.feature_id);
    } catch (err) {
      console.error("[tool-permissions] Failed to emit synthetic show_plan block:", err);
    }
  }

  if (sDbId) {
    try {
      const db2 = getDatabase();
      const approvalPayload = planMarkdown
        ? JSON.stringify({ ...input, plan: planMarkdown })
        : JSON.stringify(input);
      db2.prepare("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
        .run(approvalPayload, sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch (e) { console.warn("[tool-permissions] best-effort op failed:", e); }
  }

  try {
    const result = await getAppRuntime().runPromise(
      Effect.flatMap(ToolPermissions, (tp) => tp.requestPlanApproval(managed.id)),
    );

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
 * Delegates to the ToolPermissions Effect service (which broadcasts internally).
 */
export async function requestUserAnswers(
  subprocessId: string,
  questions: Record<string, unknown>,
): Promise<Record<string, string>> {
  return getAppRuntime().runPromise(
    Effect.flatMap(ToolPermissions, (tp) => tp.requestUserAnswer(subprocessId, questions)),
  );
}

/**
 * Request permission from the user for a tool call.
 * Delegates to the ToolPermissions Effect service.
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
    const result = await getAppRuntime().runPromise(
      Effect.flatMap(ToolPermissions, (tp) => tp.requestPermission(subprocessId, permissionRequest)),
    );

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
  getAppRuntime().runSync(
    Effect.flatMap(ToolPermissions, (tp) => tp.submitPermission(subprocessId, decision, feedback)),
  );
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

  getAppRuntime().runSync(
    Effect.flatMap(ToolPermissions, (tp) => tp.submitUserAnswer(subprocessId, answers)),
  );
}

/**
 * Submit a plan approval or rejection for a pending ExitPlanMode tool call.
 * Returns { success: true } if the Deferred was resolved or result was stored in DB.
 */
export function submitPlanApproval(
  subprocessId: string,
  approved: boolean,
  feedback?: string,
  _getActiveProcess?: (id: string) => unknown | undefined,
): { success: boolean; error?: string } {
  // Try to resolve the pending Deferred via the Effect service
  const hadDeferred = getAppRuntime().runSync(
    Effect.flatMap(ToolPermissions, (tp) => tp.submitPlanApproval(subprocessId, approved, feedback)),
  );

  if (!hadDeferred) {
    // No Deferred pending — agent is paused/dead. Store for consumption on resume.
    const sessionDbId = getSessionDbId(subprocessId);
    if (sessionDbId) {
      try {
        const db = getDatabase();
        db.prepare("UPDATE agent_sessions SET plan_approval_result = ?, pending_plan_approval = NULL WHERE id = ?")
          .run(JSON.stringify({ approved, feedback }), sessionDbId);
        const fid = getFeatureIdForSubprocess(subprocessId);
        if (fid != null) notifyDbUpdated("agent_session", fid);
      } catch { /* best-effort */ }
    }
    return { success: true };
  }

  // Deferred was resolved — persist feedback as a user message if rejecting
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

  return { success: true };
}

/**
 * Submit a PRD approval or rejection. Mirrors submitPlanApproval for the PRD flow.
 */
export function submitPrdApproval(
  subprocessId: string,
  approved: boolean,
  feedback?: string,
  _getActiveProcess?: (id: string) => unknown | undefined,
): { success: boolean; error?: string } {
  // Try to resolve the pending Deferred via the Effect service
  const hadDeferred = getAppRuntime().runSync(
    Effect.flatMap(ToolPermissions, (tp) => tp.submitPrdApproval(subprocessId, approved, feedback)),
  );

  if (!hadDeferred) {
    // No Deferred pending — agent is paused/dead. Store for consumption on resume.
    const sessionDbId = getSessionDbId(subprocessId);
    if (sessionDbId) {
      try {
        const db = getDatabase();
        db.prepare("UPDATE agent_sessions SET prd_approval_result = ?, pending_prd_approval = NULL WHERE id = ?")
          .run(JSON.stringify({ approved, feedback }), sessionDbId);
        const fid = getFeatureIdForSubprocess(subprocessId);
        if (fid != null) notifyDbUpdated("agent_session", fid);
      } catch { /* best-effort */ }
    }
    return { success: true };
  }

  // Deferred was resolved — persist feedback as a user message if rejecting
  if (!approved && feedback) {
    const sessionDbId = getSessionDbId(subprocessId);
    if (sessionDbId) {
      try {
        const content = `**PRD feedback:**\n${feedback}`;
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
