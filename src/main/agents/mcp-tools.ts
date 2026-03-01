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
import { notifyDbUpdated } from "./session-persistence";
import { transitionPhase, transitionFeature } from "./state-transitions";
import { processNextPhase } from "./execute-agent";
import { resolveAgentCwd } from "./resolve-cwd";
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
// Universal mark_agent_done tool helper
// ---------------------------------------------------------------------------

function createAgentDoneTool(sessionDbId: number, featureId: number) {
  return tool(
    "mark_agent_done",
    "Signal that the agent has completed its work. Call this when you are finished. Optionally provide a summary of what was accomplished.",
    {
      summary: z.string().optional().describe("Optional summary of what was accomplished"),
    },
    async (_args) => {
      const db = getDatabase();
      const current = db.prepare("SELECT status, agent_type, run_id FROM agent_sessions WHERE id = ?").get(sessionDbId) as { status: string; agent_type: string; run_id: number | null } | undefined;
      console.log(`[session-trace] mark_agent_done: session ${sessionDbId} (${current?.agent_type}), ${current?.status} -> completed (feature ${featureId})`);
      db.prepare(
        "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
      ).run(sessionDbId);
      notifyDbUpdated("agent_session", featureId);

      // After any execute/qa/review agent completes, chain processNextPhase
      if (["execute", "qa", "review"].includes(current?.agent_type ?? "")) {
        try {
          const wfFeat = db.prepare("SELECT project_id FROM features WHERE id = ?")
            .get(featureId) as { project_id: number } | undefined;
          if (wfFeat) {
            const { cwd, worktreePath } = resolveAgentCwd(featureId, wfFeat.project_id);
            processNextPhase({ featureId, projectId: wfFeat.project_id, cwd, worktreePath });
          }
        } catch { /* */ }
      }

      return textResult("Agent marked as done. Session completed.");
    },
  );
}

// ---------------------------------------------------------------------------
// Plan agent MCP server
// ---------------------------------------------------------------------------

/** Callback type for show_plan approval — blocks until user responds */
export type PlanApprovalCallback = (planMarkdown: string) => Promise<{ approved: boolean; feedback?: string }>;

// Plan approval is now persisted in DB (plans.status = 'approved') instead of in-memory Set.

/**
 * Create the plan MCP server.
 *
 * If `onShowPlan` is a function, it's used directly as the approval callback.
 * If it's `"deferred"`, this returns a factory that must be called with a
 * subprocess ID to produce the actual callback. This avoids the mutable ref
 * pattern where the subprocess ID isn't known at server creation time.
 */
export function createPlanMcpServer(planId: number, featureId: number, sessionDbId: number, onShowPlan?: PlanApprovalCallback) {
  return createSdkMcpServer({
    name: "productdevr-plan",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId),

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
              const db = getDatabase();
              db.prepare("UPDATE plans SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(args.plan_id);
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
          const db = getDatabase();

          const draftCount = db
            .prepare("SELECT COUNT(*) as cnt FROM phases WHERE plan_id = ? AND status = 'draft'")
            .get(args.plan_id) as { cnt: number };

          if (draftCount.cnt === 0) return errorResult("No draft phases to finalize");

          const plan = db
            .prepare("SELECT feature_id, status AS plan_status FROM plans WHERE id = ?")
            .get(args.plan_id) as { feature_id: number; plan_status: string } | undefined;

          if (!plan) return errorResult("Plan not found");

          if (plan.plan_status !== "approved") {
            return errorResult("Plan has not been approved via show_plan. Call show_plan first and get user approval before finalizing.");
          }

          // Check current feature status — only transition to 'planned' if still in draft
          const feature = db.prepare("SELECT status FROM features WHERE id = ?").get(plan.feature_id) as { status: string } | undefined;
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
          return textResult(`Plan finalized successfully. ${draftCount.cnt} phases are now pending.\n\n${markdown}`);
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Execute agent MCP server
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reusable phase-status tool: agents mark their own phase as completed
// ---------------------------------------------------------------------------

function createMarkPhaseDoneTool(featureId: number) {
  return tool(
    "mark_phase_done",
    "Mark a phase as completed. Call this after successfully finishing your work on the phase.",
    {
      phase_id: z.number().describe("The phase ID"),
      implementation_notes: z.string().optional().describe("Summary of what was implemented or tested"),
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

      transitionPhase(db, args.phase_id, "completed", featureId, {
        implementation_notes: args.implementation_notes ?? null,
        deviations: args.deviations ?? null,
      });
      return textResult(`Phase ${args.phase_id} marked as completed`);
    },
  );
}

export function createExecuteMcpServer(featureId: number, sessionDbId: number) {
  return createSdkMcpServer({
    name: "productdevr-execute",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createAgentDoneTool(sessionDbId, featureId),
      createMarkPhaseDoneTool(featureId),
    ],
  });
}

// ---------------------------------------------------------------------------
// QA agent MCP server
// ---------------------------------------------------------------------------

export function createQaMcpServer(planId: number, featureId: number, sessionDbId: number) {
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
      createAgentDoneTool(sessionDbId, featureId),

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

// ---------------------------------------------------------------------------
// Review agent MCP server
// ---------------------------------------------------------------------------

export function createReviewMcpServer(planId: number, featureId: number, sessionDbId: number) {
  return createSdkMcpServer({
    name: "productdevr-review",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId),

      tool(
        "finalize_phases",
        "Finalize all draft fix phases created during review — sets them to 'pending' so the execute orchestrator picks them up.",
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
          return textResult(`Finalized ${draftPhases.length} fix phases:\n${listing}`);
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Risk MCP server (read plan + create/update/remove phases for mitigations)
// ---------------------------------------------------------------------------

export function createRiskMcpServer(planId: number, featureId: number, sessionDbId: number) {
  return createSdkMcpServer({
    name: "productdevr-risk",
    tools: [
      readPlanTool,
      readPhaseTool,
      listPhasesTool,
      createPhaseTool(featureId),
      updatePhaseTool(planId, featureId),
      removePhaseTool(planId, featureId),
      createAgentDoneTool(sessionDbId, featureId),

      tool(
        "finalize_phases",
        "Finalize all draft mitigation phases — sets them to 'pending' so they can be executed.",
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
          return textResult(`Finalized ${draftPhases.length} mitigation phases:\n${listing}`);
        },
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// PRD agent MCP server
// ---------------------------------------------------------------------------

/** Callback type for show_prd approval — blocks until user responds */
export type PrdApprovalCallback = (prdMarkdown: string) => Promise<{ approved: boolean; feedback?: string }>;

export function createPrdMcpServer(featureId: number, sessionDbId: number, onShowPrd?: PrdApprovalCallback) {
  return createSdkMcpServer({
    name: "productdevr-prd",
    tools: [
      createAgentDoneTool(sessionDbId, featureId),

      tool(
        "create_prd",
        "Create the PRD for this feature. Use this for the initial PRD creation. Sends the full PRD markdown content.",
        {
          prd: z.string().describe("The full PRD markdown content"),
        },
        async (args) => {
          const db = getDatabase();
          db.prepare("UPDATE features SET prd = ? WHERE id = ?").run(args.prd, featureId);
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
          const db = getDatabase();
          const row = db.prepare("SELECT prd FROM features WHERE id = ?").get(featureId) as { prd: string | null } | undefined;
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
          db.prepare("UPDATE features SET prd = ? WHERE id = ?").run(updated, featureId);
          notifyDbUpdated("feature", featureId);
          return textResult("PRD updated successfully.");
        },
      ),

      tool(
        "show_prd",
        "Display the current PRD for user approval. This tool BLOCKS until the user approves or rejects. If approved, returns success. If rejected, returns the user's feedback so you can revise.",
        {},
        async () => {
          const db = getDatabase();
          const row = db.prepare("SELECT prd FROM features WHERE id = ?").get(featureId) as { prd: string | null } | undefined;
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

export function createRetroMcpServer(featureId: number, sessionDbId: number) {
  return createSdkMcpServer({
    name: "productdevr-retro",
    tools: [
      readPlanTool,
      listPhasesTool,
      readPhaseTool,
      createAgentDoneTool(sessionDbId, featureId),

      tool(
        "read_prd",
        "Read the PRD (Product Requirements Document) for this feature.",
        {},
        async () => {
          const db = getDatabase();
          const row = db
            .prepare("SELECT prd FROM features WHERE id = ?")
            .get(featureId) as { prd: string | null } | undefined;
          return textResult(row?.prd ?? "No PRD available.");
        },
      ),

      tool(
        "list_conversations",
        "List all agent sessions for this feature with metadata and message counts. Use this to get an overview before reading individual conversations.",
        {},
        async () => {
          const db = getDatabase();
          const sessions = db
            .prepare(
              `SELECT s.id, s.agent_type, s.status, s.started_at, s.ended_at,
                COUNT(m.id) as message_count
              FROM agent_sessions s
              LEFT JOIN agent_messages m ON m.session_id = s.id
              WHERE s.feature_id = ?
              GROUP BY s.id
              ORDER BY s.id ASC`,
            )
            .all(featureId) as Array<{
              id: number;
              agent_type: string;
              status: string;
              started_at: string | null;
              ended_at: string | null;
              message_count: number;
            }>;

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
          const db = getDatabase();
          const resolvedOffset = args.offset ?? 0;
          const resolvedLimit = args.limit ?? 50;

          const total = (
            db
              .prepare("SELECT COUNT(*) as cnt FROM agent_messages WHERE session_id = ?")
              .get(args.session_id) as { cnt: number } | undefined
          )?.cnt ?? 0;

          const messages = db
            .prepare(
              "SELECT role, content, message_type, tool_name FROM agent_messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
            )
            .all(args.session_id, resolvedLimit, resolvedOffset) as Array<{
              role: string;
              content: string;
              message_type: string;
              tool_name: string | null;
            }>;

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

export function createCommonMcpServer(sessionDbId: number, featureId: number) {
  return createSdkMcpServer({
    name: "productdevr-common",
    tools: [
      createAgentDoneTool(sessionDbId, featureId),
    ],
  });
}

// ---------------------------------------------------------------------------
// Workflow session MCP server (read-only plan tools + mark_agent_done)
// ---------------------------------------------------------------------------

type WorkflowSessionToolName = "read_plan" | "list_phases" | "read_phase" | "read_prd" | "mark_agent_done" | "mark_phase_done";

function createReadPrdTool(featureId: number) {
  return tool("read_prd", "Read the PRD for this feature.", {}, async () => {
    const db = getDatabase();
    const row = db.prepare("SELECT prd FROM features WHERE id = ?").get(featureId) as { prd: string | null } | undefined;
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
