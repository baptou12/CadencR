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
import { notifyDbUpdated } from "./ipc-bridge";
import type { PhaseRow, PlanRow } from "../db/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/**
 * Render a plan and its phases as formatted markdown.
 */
export function renderPlanMarkdown(planId: number): string {
  const db = getDatabase();
  const plan = db
    .prepare("SELECT * FROM plans WHERE id = ?")
    .get(planId) as PlanRow | undefined;

  if (!plan) return "Plan not found.";

  const phases = db
    .prepare(
      "SELECT * FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
    )
    .all(planId) as PhaseRow[];

  const sections: string[] = [];
  sections.push(`# Plan: ${plan.title}`);

  if (plan.summary) sections.push(`## Summary\n\n${plan.summary}`);
  if (plan.context) sections.push(`## Context\n\n${plan.context}`);
  if (plan.clarifications) sections.push(`## Clarifications\n\n${plan.clarifications}`);
  if (plan.completion_conditions) sections.push(`## Completion Conditions\n\n${plan.completion_conditions}`);

  if (phases.length > 0) {
    sections.push("## Phases\n");
    for (const phase of phases) {
      const lines = [`### Phase ${phase.step_number}: ${phase.title}`];
      lines.push(`- **Step**: ${phase.step_number}`);
      lines.push(`- **Type**: ${phase.phase_type}`);
      lines.push(`- **Complexity**: ${phase.complexity}`);
      lines.push(`- **Status**: ${phase.status}`);
      if (phase.commit_message) lines.push(`- **Commit message**: ${phase.commit_message}`);
      if (phase.prompt) lines.push(`\n${phase.prompt}`);
      sections.push(lines.join("\n"));
    }
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Shared read-only tools (available to all agents)
// ---------------------------------------------------------------------------

const readPlanTool = tool(
  "read_plan",
  "Read a plan's metadata (title, summary, context, clarifications, completion conditions) and list all its phases with their current status.",
  {
    plan_id: z.number().describe("The plan ID to read"),
  },
  async (args) => {
    return textResult(renderPlanMarkdown(args.plan_id));
  },
);

const listPhasesTool = tool(
  "list_phases",
  "List all phases of a plan with their IDs, titles, step numbers, statuses, and types. Useful for getting an overview of what phases exist.",
  {
    plan_id: z.number().describe("The plan ID"),
  },
  async (args) => {
    const db = getDatabase();
    const phases = db
      .prepare(
        "SELECT id, step_number, title, status, phase_type, complexity FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
      )
      .all(args.plan_id) as Array<{ id: number; step_number: number; title: string; status: string; phase_type: string; complexity: number }>;

    if (phases.length === 0) return textResult("No phases found for this plan.");

    const lines = phases.map(
      (p) => `- [${p.status}] Phase ${p.id} (step ${p.step_number}): ${p.title} — type=${p.phase_type}, complexity=${p.complexity}`,
    );
    return textResult(`${phases.length} phases:\n${lines.join("\n")}`);
  },
);

const readPhaseTool = tool(
  "read_phase",
  "Read a specific phase's full details including its prompt, status, complexity, and implementation notes.",
  {
    phase_id: z.number().describe("The phase ID to read"),
  },
  async (args) => {
    const db = getDatabase();
    const phase = db
      .prepare("SELECT * FROM phases WHERE id = ?")
      .get(args.phase_id) as PhaseRow | undefined;

    if (!phase) return errorResult(`Phase ${args.phase_id} not found`);

    const lines = [
      `# Phase ${phase.id}: ${phase.title}`,
      `- **Plan ID**: ${phase.plan_id}`,
      `- **Step**: ${phase.step_number}`,
      `- **Status**: ${phase.status}`,
      `- **Type**: ${phase.phase_type}`,
      `- **Complexity**: ${phase.complexity}`,
      `- **Commit message**: ${phase.commit_message ?? "(none)"}`,
      `- **Order index**: ${phase.order_index}`,
    ];
    if (phase.prompt) lines.push(`\n## Prompt\n\n${phase.prompt}`);
    if (phase.implementation_notes) lines.push(`\n## Implementation Notes\n\n${phase.implementation_notes}`);
    if (phase.deviations) lines.push(`\n## Deviations\n\n${phase.deviations}`);

    return textResult(lines.join("\n"));
  },
);

// ---------------------------------------------------------------------------
// Shared phase tools (used by plan + QA agents)
// ---------------------------------------------------------------------------

function createPhaseTool(featureId: number) {
  return tool(
    "create_phase",
    "Create a new draft phase in the plan. The phase starts with status 'draft' and must be finalized before execution.",
    {
      plan_id: z.number().describe("The plan ID to add the phase to"),
      step_number: z.number().describe("Step number (phases in the same step run in parallel)"),
      title: z.string().describe("Short title for this phase"),
      prompt: z.string().describe("Detailed description of what this phase should implement"),
      complexity: z.number().min(1).max(5).optional().describe("Complexity 1-5 (default 3)"),
      commit_message: z.string().optional().describe("Conventional commit message (e.g. 'feat: add login form')"),
      phase_type: z.enum(["setup", "value", "qa"]).optional().describe("Phase type: setup (foundational), value (feature work), qa (test checkpoint). Default: value"),
    },
    async (args) => {
      const db = getDatabase();
      // Get max order_index for this plan
      const maxOrder = db
        .prepare("SELECT MAX(order_index) as max_idx FROM phases WHERE plan_id = ?")
        .get(args.plan_id) as { max_idx: number | null } | undefined;
      const orderIndex = (maxOrder?.max_idx ?? -1) + 1;

      const result = db
        .prepare(
          "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
        )
        .run(
          args.plan_id,
          args.step_number,
          args.title,
          args.complexity ?? 3,
          args.commit_message ?? null,
          args.prompt,
          orderIndex,
          args.phase_type ?? "value",
        );

      notifyDbUpdated("phase", featureId);
      return textResult(`Phase created with id=${result.lastInsertRowid}, title="${args.title}", step=${args.step_number}`);
    },
  );
}

function updatePhaseTool(planId: number, featureId: number) {
  return tool(
    "update_phase",
    "Update an existing draft phase. Only phases with status 'draft' can be edited.",
    {
      phase_id: z.number().describe("The phase ID to update"),
      title: z.string().optional().describe("New title"),
      step_number: z.number().optional().describe("New step number"),
      complexity: z.number().min(1).max(5).optional().describe("New complexity"),
      commit_message: z.string().optional().describe("New commit message"),
      prompt: z.string().optional().describe("New prompt/description"),
      phase_type: z.enum(["setup", "value", "qa"]).optional().describe("New phase type"),
    },
    async (args) => {
      const db = getDatabase();
      const phase = db
        .prepare("SELECT status, plan_id FROM phases WHERE id = ?")
        .get(args.phase_id) as { status: string; plan_id: number } | undefined;

      if (!phase) return errorResult(`Phase ${args.phase_id} not found`);
      if (phase.plan_id !== planId) return errorResult(`Phase ${args.phase_id} does not belong to plan ${planId}`);
      if (phase.status !== "draft") return errorResult(`Phase ${args.phase_id} has status '${phase.status}', only 'draft' phases can be edited`);

      const updates: string[] = [];
      const values: unknown[] = [];

      if (args.title !== undefined) { updates.push("title = ?"); values.push(args.title); }
      if (args.step_number !== undefined) { updates.push("step_number = ?"); values.push(args.step_number); }
      if (args.complexity !== undefined) { updates.push("complexity = ?"); values.push(args.complexity); }
      if (args.commit_message !== undefined) { updates.push("commit_message = ?"); values.push(args.commit_message); }
      if (args.prompt !== undefined) { updates.push("prompt = ?"); values.push(args.prompt); }
      if (args.phase_type !== undefined) { updates.push("phase_type = ?"); values.push(args.phase_type); }

      if (updates.length === 0) return errorResult("No fields to update");

      values.push(args.phase_id);
      db.prepare(`UPDATE phases SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      notifyDbUpdated("phase", featureId);
      return textResult(`Phase ${args.phase_id} updated`);
    },
  );
}

function removePhaseTool(planId: number, featureId: number) {
  return tool(
    "remove_phase",
    "Remove a draft phase from the plan. Only phases with status 'draft' can be removed.",
    {
      phase_id: z.number().describe("The phase ID to remove"),
    },
    async (args) => {
      const db = getDatabase();
      const phase = db
        .prepare("SELECT status, plan_id FROM phases WHERE id = ?")
        .get(args.phase_id) as { status: string; plan_id: number } | undefined;

      if (!phase) return errorResult(`Phase ${args.phase_id} not found`);
      if (phase.plan_id !== planId) return errorResult(`Phase ${args.phase_id} does not belong to plan ${planId}`);
      if (phase.status !== "draft") return errorResult(`Phase ${args.phase_id} has status '${phase.status}', only 'draft' phases can be removed`);

      db.prepare("DELETE FROM phases WHERE id = ?").run(args.phase_id);
      notifyDbUpdated("phase", featureId);
      return textResult(`Phase ${args.phase_id} removed`);
    },
  );
}

// ---------------------------------------------------------------------------
// Plan agent MCP server
// ---------------------------------------------------------------------------

/** Callback type for show_plan approval — blocks until user responds */
export type PlanApprovalCallback = (planMarkdown: string) => Promise<{ approved: boolean; feedback?: string }>;

/** Tracks which plans have been approved via show_plan (server-side enforcement for finalize_plan) */
const approvedPlans = new Set<number>();

/**
 * Create the plan MCP server.
 *
 * If `onShowPlan` is a function, it's used directly as the approval callback.
 * If it's `"deferred"`, this returns a factory that must be called with a
 * subprocess ID to produce the actual callback. This avoids the mutable ref
 * pattern where the subprocess ID isn't known at server creation time.
 */
export function createPlanMcpServer(planId: number, featureId: number, onShowPlan?: PlanApprovalCallback) {
  return createSdkMcpServer({
    name: "productdevr-plan",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),

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
          const db = getDatabase();
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
          db.prepare(`UPDATE plans SET ${updates.join(", ")} WHERE id = ?`).run(...values);
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
              approvedPlans.add(args.plan_id);
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
          const db = getDatabase();

          const draftCount = db
            .prepare("SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'draft'")
            .get(args.plan_id) as { cnt: number };

          if (draftCount.cnt === 0) return errorResult("No draft phases to finalize");

          if (!approvedPlans.has(args.plan_id)) {
            return errorResult("Plan has not been approved via show_plan. Call show_plan first and get user approval before finalizing.");
          }

          const plan = db
            .prepare("SELECT feature_id FROM plans WHERE id = ?")
            .get(args.plan_id) as { feature_id: number } | undefined;

          if (!plan) return errorResult("Plan not found");

          db.transaction(() => {
            db.prepare("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'").run(args.plan_id);
            db.prepare("UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(args.plan_id);
            db.prepare("UPDATE features SET status = 'planned' WHERE id = ?").run(plan.feature_id);
          })();

          approvedPlans.delete(args.plan_id);
          notifyDbUpdated("phase", plan.feature_id);
          notifyDbUpdated("feature", plan.feature_id);

          const markdown = renderPlanMarkdown(args.plan_id);
          return textResult(`Plan finalized successfully. ${draftCount.cnt} phases are now pending.\n\n${markdown}`);
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Execute agent MCP server
// ---------------------------------------------------------------------------

export function createExecuteMcpServer(featureId: number) {
  return createSdkMcpServer({
    name: "productdevr-execute",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      tool(
        "mark_phase_in_progress",
        "Mark a phase as in-progress (running). Call this at the start of phase execution.",
        {
          phase_id: z.number().describe("The phase ID"),
        },
        async (args) => {
          const db = getDatabase();
          const phase = db
            .prepare("SELECT status FROM phases WHERE id = ?")
            .get(args.phase_id) as { status: string } | undefined;

          if (!phase) return errorResult(`Phase ${args.phase_id} not found`);
          if (phase.status !== "pending" && phase.status !== "error") {
            return errorResult(`Phase ${args.phase_id} has status '${phase.status}', expected 'pending' or 'error'`);
          }

          db.prepare("UPDATE phases SET status = 'running' WHERE id = ?").run(args.phase_id);
          notifyDbUpdated("phase", featureId);
          return textResult(`Phase ${args.phase_id} is now running`);
        },
      ),

      tool(
        "mark_phase_done",
        "Mark a phase as completed. Call this after successfully implementing the phase.",
        {
          phase_id: z.number().describe("The phase ID"),
          implementation_notes: z.string().optional().describe("Summary of what was implemented"),
          deviations: z.string().optional().describe("Any deviations from the original plan"),
        },
        async (args) => {
          const db = getDatabase();
          const phase = db
            .prepare("SELECT status FROM phases WHERE id = ?")
            .get(args.phase_id) as { status: string } | undefined;

          if (!phase) return errorResult(`Phase ${args.phase_id} not found`);
          if (phase.status !== "running") {
            return errorResult(`Phase ${args.phase_id} has status '${phase.status}', expected 'running'`);
          }

          db.prepare(
            "UPDATE phases SET status = 'completed', implementation_notes = ?, deviations = ? WHERE id = ?",
          ).run(args.implementation_notes ?? null, args.deviations ?? null, args.phase_id);
          notifyDbUpdated("phase", featureId);
          return textResult(`Phase ${args.phase_id} marked as completed`);
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// QA agent MCP server
// ---------------------------------------------------------------------------

export function createQaMcpServer(planId: number, featureId: number) {
  return createSdkMcpServer({
    name: "productdevr-qa",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),

      tool(
        "finalize_phases",
        "Finalize all draft phases created during QA — sets them to 'pending' so the execute orchestrator picks them up.",
        {
          plan_id: z.number().describe("The plan ID"),
        },
        async (args) => {
          if (args.plan_id !== planId) {
            return errorResult(`Expected plan_id ${planId}, got ${args.plan_id}`);
          }
          const db = getDatabase();
          const draftPhases = db
            .prepare("SELECT id, title, step_number FROM phases WHERE plan_id = ? AND status = 'draft' ORDER BY step_number, order_index")
            .all(planId) as Array<{ id: number; title: string; step_number: number }>;

          if (draftPhases.length === 0) return errorResult("No draft phases to finalize");

          db.prepare("UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'").run(planId);
          notifyDbUpdated("phase", featureId);

          const listing = draftPhases.map((p) => `- Phase ${p.id}: "${p.title}" (step ${p.step_number})`).join("\n");
          return textResult(`Finalized ${draftPhases.length} phases:\n${listing}`);
        },
      ),
    ],
  });
}
