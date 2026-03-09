/**
 * Plan agent MCP server.
 */

import { z } from "zod";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { getDatabase } from "../../db/database";
import { queryOne, execute } from "../../db/query";
import { AppRuntime } from "../../effect/runtime";
import { notifyDbUpdated } from "../effect-helpers";
import { transitionFeature } from "../state-transitions";
import { textResult, errorResult, renderPlanMarkdown } from "./helpers";
import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createPhaseTool,
  updatePhaseTool,
  removePhaseTool,
  createAgentDoneTool,
} from "./shared-tools";
import type { OnAgentDoneCallback } from "./shared-tools";

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
    name: "cadence-plan",
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
          try {
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
            await AppRuntime.runPromise(execute(`UPDATE plans SET ${updates.join(", ")} WHERE id = ?`, ...values));
            notifyDbUpdated("plan", featureId);
            return textResult("Plan updated");
          } catch (e) {
            return errorResult(`Failed to update plan: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      ),

      tool(
        "show_plan",
        "Display the current plan and all its phases for user approval. This tool BLOCKS until the user approves or rejects. If approved, returns success. If rejected, returns the user's feedback so you can revise.",
        {
          plan_id: z.number().describe("The plan ID"),
        },
        async (args) => {
          const markdown = await renderPlanMarkdown(args.plan_id);
          if (!onShowPlan) {
            return textResult(markdown);
          }
          try {
            const result = await onShowPlan(markdown);
            if (result.approved) {
              await AppRuntime.runPromise(execute("UPDATE plans SET status = 'approved', updated_at = datetime('now') WHERE id = ?", args.plan_id));
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
          try {
            const draftCountRow = await AppRuntime.runPromise(queryOne<{ cnt: number }>(
              "SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'draft'",
              args.plan_id,
            ));
            const draftCount = draftCountRow?.cnt ?? 0;

            if (draftCount === 0) return errorResult("No draft phases to finalize");

            const plan = await AppRuntime.runPromise(queryOne<{ feature_id: number; plan_status: string }>(
              "SELECT feature_id, status AS plan_status FROM plans WHERE id = ?",
              args.plan_id,
            ));

            if (!plan) return errorResult("Plan not found");

            if (plan.plan_status !== "approved") {
              return errorResult("Plan has not been approved via show_plan. Call show_plan first and get user approval before finalizing.");
            }

            // Check current feature status — only transition to 'planned' if still in draft
            const feature = await AppRuntime.runPromise(queryOne<{ status: string }>(
              "SELECT status FROM features WHERE id = ?",
              plan.feature_id,
            ));

            const db = getDatabase();
            db.transaction(() => {
              db.prepare("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'").run(args.plan_id);
              db.prepare("UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(args.plan_id);
              // Transition feature to 'planned' if it's a draft or done (refinement resets done features)
              if (!feature || feature.status === "draft" || feature.status === "done") {
                transitionFeature(db, plan.feature_id, "planned");
              }
            })();
            notifyDbUpdated("phase", plan.feature_id);

            const markdown = await renderPlanMarkdown(args.plan_id);
            return textResult(`Plan finalized successfully. ${draftCount} phases are now pending.\n\n${markdown}`);
          } catch (e) {
            return errorResult(`Failed to finalize plan: ${e instanceof Error ? e.message : String(e)}`);
          }
        },
      ),
    ],
  });
}
