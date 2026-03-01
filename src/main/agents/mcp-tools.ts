/**
 * MCP tool servers for agent types.
 *
 * Instead of parsing structured markdown output, agents call these tools
 * to directly create/edit/remove phases and update plan metadata in the DB.
 * Uses the Claude Agent SDK's in-process MCP server support.
 */

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { getDatabase } from "../db/database";
import { queryOne, queryAll, execute } from "../db/query";
import { notifyDbUpdated } from "./session-persistence";
import { transitionFeature } from "./state-transitions";
import { resolveAgentCwd } from "./resolve-cwd";
import {
  textResult,
  errorResult,
  renderPlanMarkdown,
} from "./mcp-tools/helpers";
import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createPhaseTool,
  updatePhaseTool,
  removePhaseTool,
  createAgentDoneTool,
  createMarkPhaseDoneTool,
  createFinalizePhasesTool,
} from "./mcp-tools/shared-tools";

/** Callback invoked when an execute/qa/review agent calls mark_agent_done */
export type OnAgentDoneCallback = (options: { featureId: number; projectId: number; cwd: string; worktreePath: string | null }) => void;

// Re-export for backward compatibility
export { renderPlanMarkdown };

// ---------------------------------------------------------------------------
// Plan agent MCP server
// ---------------------------------------------------------------------------

/** Callback type for show_plan approval — blocks until user responds */
export type PlanApprovalCallback = (planMarkdown: string) => Promise<{ approved: boolean; feedback?: string }>;

/**
 * Create the plan MCP server.
 *
 * If `onShowPlan` is a function, it's used directly as the approval callback.
 * If it's `"deferred"`, this returns a factory that must be called with a
 * subprocess ID to produce the actual callback. This avoids the mutable ref
 * pattern where the subprocess ID isn't known at server creation time.
 */
export function createPlanMcpServer(planId: number, featureId: number, sessionDbId: number, onShowPlan?: PlanApprovalCallback, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-plan",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),

      tool(
        "update_plan",
        "Update plan-level metadata (title, summary, context, clarifications, completion conditions).",
        {
          plan_id: z.number().describe("The plan ID"),
          title: z.string().optional().describe("Plan title"),
          summary: z.string().optional().describe("1-3 sentence summary"),
          context: z.string().optional().describe("Codebase context discovered during exploration"),
          clarifications: z.string().optional().describe("Q&A from the user"),
          completion_conditions: z.string().optional().describe("Conditions that should be true when the plan is complete"),
        },
        async (args) => {
          const updates: string[] = [];
          const values: unknown[] = [];

          if (args.title !== undefined) { updates.push("title = ?"); values.push(args.title); }
          if (args.summary !== undefined) { updates.push("summary = ?"); values.push(args.summary); }
          if (args.context !== undefined) { updates.push("context = ?"); values.push(args.context); }
          if (args.clarifications !== undefined) { updates.push("clarifications = ?"); values.push(args.clarifications); }
          if (args.completion_conditions !== undefined) { updates.push("completion_conditions = ?"); values.push(args.completion_conditions); }

          if (updates.length === 0) return errorResult("No fields to update");

          updates.push("updated_at = datetime('now')");
          values.push(args.plan_id);
          execute(`UPDATE plans SET ${updates.join(", ")} WHERE id = ?`, ...values);
          notifyDbUpdated("plan", featureId);
          return textResult("Plan updated");
        },
      ),

      tool(
        "show_plan",
        "Display the current plan and all its phases for user approval. This tool BLOCKS until the user approves or rejects. If approved, returns success. If rejected, returns the user's feedback so you can revise.",
        {
          plan_id: z.number().describe("The plan ID"),
        },
        async (args) => {
          const markdown = renderPlanMarkdown(args.plan_id);
          if (!onShowPlan) {
            return textResult(markdown);
          }
          try {
            const result = await onShowPlan(markdown);
            if (result.approved) {
              execute("UPDATE plans SET status = 'approved', updated_at = datetime('now') WHERE id = ?", args.plan_id);
              notifyDbUpdated("plan", featureId);
              return textResult("✅ Plan approved by the user. You may now call finalize_plan.");
            } else {
              return errorResult(`User requested changes: ${result.feedback || "No specific feedback provided."}`);
            }
          } catch (error) {
            return errorResult(`Plan approval failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      ),

      tool(
        "finalize_plan",
        "Finalize the plan: set all draft phases to 'pending', plan status to 'active', and feature status to 'planned'. Call this after the user approves the plan.",
        {
          plan_id: z.number().describe("The plan ID"),
        },
        async (args) => {
          const draftCount = queryOne<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'draft'",
            args.plan_id,
          ).map((r) => r.cnt).getOr(0);

          if (draftCount === 0) return errorResult("No draft phases to finalize");

          const plan = queryOne<{ feature_id: number; plan_status: string }>(
            "SELECT feature_id, status AS plan_status FROM plans WHERE id = ?",
            args.plan_id,
          ).toUndefined();

          if (!plan) return errorResult("Plan not found");

          if (plan.plan_status !== "approved") {
            return errorResult("Plan has not been approved via show_plan. Call show_plan first and get user approval before finalizing.");
          }

          // Check current feature status — only transition to 'planned' if still in draft
          const feature = queryOne<{ status: string }>(
            "SELECT status FROM features WHERE id = ?",
            plan.feature_id,
          ).toUndefined();

          const db = getDatabase();
          db.transaction(() => {
            db.prepare("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'").run(args.plan_id);
            db.prepare("UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(args.plan_id);
            // Only transition feature to 'planned' if it's still a draft — don't regress in-progress/review features
            if (!feature || feature.status === "draft") {
              transitionFeature(db, plan.feature_id, "planned");
            }
          })();
          notifyDbUpdated("phase", plan.feature_id);

          const markdown = renderPlanMarkdown(args.plan_id);
          return textResult(`Plan finalized successfully. ${draftCount} phases are now pending.\n\n${markdown}`);
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Execute agent MCP server
// ---------------------------------------------------------------------------

export function createExecuteMcpServer(featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-execute",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createMarkPhaseDoneTool(featureId),
    ],
  });
}

// ---------------------------------------------------------------------------
// QA agent MCP server
// ---------------------------------------------------------------------------

export function createQaMcpServer(planId: number, featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-qa",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createMarkPhaseDoneTool(featureId),
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createFinalizePhasesTool(planId, featureId, "phases"),
    ],
  });
}

// ---------------------------------------------------------------------------
// Review agent MCP server
// ---------------------------------------------------------------------------

export function createReviewMcpServer(planId: number, featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-review",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createFinalizePhasesTool(planId, featureId, "fix phases"),
    ],
  });
}

// ---------------------------------------------------------------------------
// Risk MCP server (read plan + create/update/remove phases for mitigations)
// ---------------------------------------------------------------------------

export function createRiskMcpServer(planId: number, featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-risk",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
      createFinalizePhasesTool(planId, featureId, "mitigation phases"),
    ],
  });
}

// ---------------------------------------------------------------------------
// PRD agent MCP server
// ---------------------------------------------------------------------------

/** Callback type for show_prd approval — blocks until user responds */
export type PrdApprovalCallback = (prdMarkdown: string) => Promise<{ approved: boolean; feedback?: string }>;

export function createPrdMcpServer(featureId: number, sessionDbId: number, onShowPrd?: PrdApprovalCallback, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-prd",
    tools: [
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),

      tool(
        "create_prd",
        "Create the PRD for this feature. Use this for the initial PRD creation. Sends the full PRD markdown content.",
        {
          prd: z.string().describe("The full PRD markdown content"),
        },
        async (args) => {
          execute("UPDATE features SET prd = ? WHERE id = ?", args.prd, featureId);
          notifyDbUpdated("feature", featureId);
          return textResult("PRD created successfully.");
        },
      ),

      tool(
        "edit_prd",
        "Edit the PRD by finding a string and replacing it. The old_string must match exactly (including whitespace and newlines). Use this for revisions instead of rewriting the entire PRD.",
        {
          old_string: z.string().describe("The exact string to find in the current PRD"),
          new_string: z.string().describe("The string to replace it with"),
        },
        async (args) => {
          const row = queryOne<{ prd: string | null }>(
            "SELECT prd FROM features WHERE id = ?",
            featureId,
          ).toUndefined();

          if (!row?.prd) {
            return errorResult("No PRD exists yet. Use create_prd first.");
          }
          if (!row.prd.includes(args.old_string)) {
            return errorResult("old_string not found in the current PRD. Make sure it matches exactly.");
          }
          const occurrences = row.prd.split(args.old_string).length - 1;
          if (occurrences > 1) {
            return errorResult(`old_string found ${occurrences} times in the PRD. Provide a larger/more unique string to match exactly once.`);
          }
          const updated = row.prd.replace(args.old_string, args.new_string);
          execute("UPDATE features SET prd = ? WHERE id = ?", updated, featureId);
          notifyDbUpdated("feature", featureId);
          return textResult("PRD updated successfully.");
        },
      ),

      tool(
        "show_prd",
        "Display the current PRD for user approval. This tool BLOCKS until the user approves or rejects. If approved, returns success. If rejected, returns the user's feedback so you can revise.",
        {},
        async () => {
          const row = queryOne<{ prd: string | null }>(
            "SELECT prd FROM features WHERE id = ?",
            featureId,
          ).toUndefined();
          const prdMarkdown = row?.prd ?? "(No PRD content found)";

          if (!onShowPrd) {
            return textResult(prdMarkdown);
          }
          try {
            const result = await onShowPrd(prdMarkdown);
            if (result.approved) {
              return textResult("✅ PRD approved by the user. You may now call mark_agent_done.");
            } else {
              return errorResult(`User requested changes: ${result.feedback || "No specific feedback provided."}`);
            }
          } catch (error) {
            return errorResult(`PRD approval failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Retro agent MCP server
// ---------------------------------------------------------------------------

export function createRetroMcpServer(featureId: number, sessionDbId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-retro",
    tools: [
      readPlanTool,
      listPhasesTool,
      readPhaseTool,
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),

      tool(
        "read_prd",
        "Read the PRD (Product Requirements Document) for this feature.",
        {},
        async () => {
          const row = queryOne<{ prd: string | null }>(
            "SELECT prd FROM features WHERE id = ?",
            featureId,
          ).toUndefined();
          return textResult(row?.prd ?? "No PRD available.");
        },
      ),

      tool(
        "list_conversations",
        "List all agent sessions for this feature with metadata and message counts. Use this to get an overview before reading individual conversations.",
        {},
        async () => {
          const result = queryAll<{
            id: number;
            agent_type: string;
            status: string;
            started_at: string | null;
            ended_at: string | null;
            message_count: number;
          }>(
            `SELECT s.id, s.agent_type, s.status, s.started_at, s.ended_at,
                COUNT(m.id) as message_count
              FROM agent_sessions s
              LEFT JOIN agent_messages m ON m.session_id = s.id
              WHERE s.feature_id = ?
              GROUP BY s.id
              ORDER BY s.id ASC`,
            featureId,
          );
          const sessions = result.getOr([]);

          if (sessions.length === 0) return textResult("No agent sessions found for this feature.");

          const lines = sessions.map(
            (s) =>
              `- Session ${s.id} [${s.agent_type}] status=${s.status} messages=${s.message_count} started=${s.started_at ?? "never"} ended=${s.ended_at ?? "running"}`,
          );
          return textResult(`${sessions.length} sessions:\n${lines.join("\n")}`);
        },
      ),

      tool(
        "read_conversation",
        "Read messages from an agent session with pagination. Returns messages formatted as [role] content with metadata.",
        {
          session_id: z.number().describe("The session ID to read messages from"),
          offset: z.number().optional().describe("Starting offset (default 0)"),
          limit: z.number().optional().describe("Max messages to return (default 50)"),
        },
        async (args) => {
          const resolvedOffset = args.offset ?? 0;
          const resolvedLimit = args.limit ?? 50;

          const total = queryOne<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM agent_messages WHERE session_id = ?",
            args.session_id,
          ).map((r) => r.cnt).getOr(0);

          const msgResult = queryAll<{
            role: string;
            content: string;
            message_type: string;
            tool_name: string | null;
          }>(
            "SELECT role, content, message_type, tool_name FROM agent_messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
            args.session_id,
            resolvedLimit,
            resolvedOffset,
          );
          const messages = msgResult.getOr([]);

          if (messages.length === 0 && resolvedOffset === 0) {
            return textResult(`No messages found for session ${args.session_id}.`);
          }

          const formatted = messages.map((m) => {
            const meta = m.tool_name ? ` (${m.message_type}, tool=${m.tool_name})` : m.message_type !== "text" ? ` (${m.message_type})` : "";
            return `[${m.role}]${meta} ${m.content}`;
          });

          const hasMore = resolvedOffset + messages.length < total;
          const summary = `Messages ${resolvedOffset + 1}-${resolvedOffset + messages.length} of ${total} total${hasMore ? " (more available)" : ""}:\n\n`;
          return textResult(summary + formatted.join("\n\n"));
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Common MCP server (for agents without dedicated servers: Session)
// ---------------------------------------------------------------------------

export function createCommonMcpServer(sessionDbId: number, featureId: number, onAgentDone?: OnAgentDoneCallback) {
  return createSdkMcpServer({
    name: "productdevr-common",
    tools: [
      createAgentDoneTool(sessionDbId, featureId, onAgentDone),
    ],
  });
}

// ---------------------------------------------------------------------------
// Workflow session MCP server (read-only plan tools + mark_agent_done)
// ---------------------------------------------------------------------------

type WorkflowSessionToolName = "read_plan" | "list_phases" | "read_phase" | "read_prd" | "mark_agent_done" | "mark_phase_done";

function createReadPrdTool(featureId: number) {
  return tool("read_prd", "Read the PRD for this feature.", {}, async () => {
    const row = queryOne<{ prd: string | null }>(
      "SELECT prd FROM features WHERE id = ?",
      featureId,
    ).toUndefined();
    if (!row?.prd) return textResult("No PRD exists for this feature.");
    return textResult(row.prd);
  });
}

export function createWorkflowSessionMcpServer(
  sessionDbId: number,
  featureId: number,
  allowedTools: WorkflowSessionToolName[],
) {
  const toolMap = {
    read_plan: readPlanTool,
    list_phases: listPhasesTool,
    read_phase: readPhaseTool,
    read_prd: createReadPrdTool(featureId),
    mark_agent_done: createAgentDoneTool(sessionDbId, featureId),
    mark_phase_done: createMarkPhaseDoneTool(featureId),
  };
  return createSdkMcpServer({
    name: "productdevr-session",
    tools: allowedTools.map((name) => toolMap[name]),
  });
}
