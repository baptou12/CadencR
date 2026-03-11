/**
 * Shared MCP tool definitions used across multiple agent servers.
 */

import { z } from "zod";
import { Effect } from "effect";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { queryOne, queryAll, queryOneValidated, execute } from "../../db/query";
import { AppRuntime } from "../../effect/runtime";
import { notifyDbUpdated } from "../effect-helpers";
import { transitionPhase } from "../state-transitions";
import { resolveAgentCwd } from "../resolve-cwd";
import { textResult, errorResult, renderPlanMarkdown } from "./helpers";
import { PhaseRowSchema } from "../../effect/schemas/db-schemas";

/** Callback invoked when an execute/qa/review agent calls mark_agent_done */
export type OnAgentDoneCallback = (options: { featureId: number; projectId: number; cwd: string; worktreePath: string | null }) => void;

// ---------------------------------------------------------------------------
// Shared read-only tools (available to all agents)
// ---------------------------------------------------------------------------

export const readPlanTool = tool(
  "read_plan",
  "Read a plan's metadata (title, summary, context, clarifications, completion conditions) and list all its phases with their current status.",
  {
    plan_id: z.number().describe("The plan ID to read"),
  },
  async (args) => textResult(await renderPlanMarkdown(args.plan_id)),
);

export const listPhasesTool = tool(
  "list_phases",
  "List all phases of a plan with their IDs, titles, step numbers, statuses, and types. Useful for getting an overview of what phases exist.",
  {
    plan_id: z.number().describe("The plan ID"),
  },
  async (args) => {
    try {
      const phases = await AppRuntime.runPromise(queryAll<{ id: number; step_number: number; title: string; status: string; phase_type: string; complexity: number }>(
        "SELECT id, step_number, title, status, phase_type, complexity FROM phases WHERE plan_id = ? ORDER BY step_number, order_index",
        args.plan_id,
      ));

      if (phases.length === 0) return textResult("No phases found for this plan.");

      const lines = phases.map(
        (p) => `- [${p.status}] Phase ${p.id} (step ${p.step_number}): ${p.title} — type=${p.phase_type}, complexity=${p.complexity}`,
      );
      return textResult(`${phases.length} phases:\n${lines.join("\n")}`);
    } catch (e) {
      return errorResult(`Failed to list phases: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

export const readPhaseTool = tool(
  "read_phase",
  "Read a specific phase's full details including its prompt, status, complexity, and implementation notes.",
  {
    phase_id: z.number().describe("The phase ID to read"),
  },
  async (args) => {
    try {
      const phase = await AppRuntime.runPromise(queryOneValidated(PhaseRowSchema, "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE id = ?", args.phase_id));
      if (phase === null) return errorResult(`Phase ${args.phase_id} not found`);

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
    } catch (e) {
      return errorResult(`Failed to read phase: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

// ---------------------------------------------------------------------------
// Shared phase tools (used by plan + QA agents)
// ---------------------------------------------------------------------------

export function createPhaseTool(featureId: number) {
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
      try {
        const maxOrderRow = await AppRuntime.runPromise(queryOne<{ max_idx: number | null }>(
          "SELECT MAX(order_index) as max_idx FROM phases WHERE plan_id = ?",
          args.plan_id,
        ));
        const orderIndex = (maxOrderRow?.max_idx ?? -1) + 1;

        const r = await AppRuntime.runPromise(execute(
          "INSERT INTO phases (plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, phase_type) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
          args.plan_id,
          args.step_number,
          args.title,
          args.complexity ?? 3,
          args.commit_message ?? null,
          args.prompt,
          orderIndex,
          args.phase_type ?? "value",
        ));
        notifyDbUpdated("phase", featureId);
        return textResult(`Phase created with id=${r.lastInsertRowid}, title="${args.title}", step=${args.step_number}`);
      } catch (e) {
        return errorResult(`Failed to create phase: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

export function updatePhaseTool(planId: number, featureId: number) {
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
      try {
        const phase = await AppRuntime.runPromise(queryOne<{ status: string; plan_id: number }>(
          "SELECT status, plan_id FROM phases WHERE id = ?",
          args.phase_id,
        ));
        if (phase === null) return errorResult(`Phase ${args.phase_id} not found`);
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
        await AppRuntime.runPromise(execute(`UPDATE phases SET ${updates.join(", ")} WHERE id = ?`, ...values));
        notifyDbUpdated("phase", featureId);
        return textResult(`Phase ${args.phase_id} updated`);
      } catch (e) {
        return errorResult(`Failed to update phase: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

export function removePhaseTool(planId: number, featureId: number) {
  return tool(
    "remove_phase",
    "Remove a draft phase from the plan. Only phases with status 'draft' can be removed.",
    {
      phase_id: z.number().describe("The phase ID to remove"),
    },
    async (args) => {
      try {
        const phase = await AppRuntime.runPromise(queryOne<{ status: string; plan_id: number }>(
          "SELECT status, plan_id FROM phases WHERE id = ?",
          args.phase_id,
        ));
        if (phase === null) return errorResult(`Phase ${args.phase_id} not found`);
        if (phase.plan_id !== planId) return errorResult(`Phase ${args.phase_id} does not belong to plan ${planId}`);
        if (phase.status !== "draft") return errorResult(`Phase ${args.phase_id} has status '${phase.status}', only 'draft' phases can be removed`);

        await AppRuntime.runPromise(execute("DELETE FROM phases WHERE id = ?", args.phase_id));
        notifyDbUpdated("phase", featureId);
        return textResult(`Phase ${args.phase_id} removed`);
      } catch (e) {
        return errorResult(`Failed to remove phase: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Universal mark_agent_done tool helper
// ---------------------------------------------------------------------------

export function createAgentDoneTool(sessionDbId: number, featureId: number, onAgentDone?: OnAgentDoneCallback) {
  return tool(
    "mark_agent_done",
    "Signal that the agent has completed its work. Call this when you are finished. Optionally provide a summary of what was accomplished.",
    {
      summary: z.string().optional().describe("Optional summary of what was accomplished"),
    },
    async (_args) => {
      try {
        const current = await AppRuntime.runPromise(queryOne<{ status: string; agent_type: string; run_id: number | null }>(
          "SELECT status, agent_type, run_id FROM agent_sessions WHERE id = ?",
          sessionDbId,
        ));

        console.log(`[session-trace] mark_agent_done: session ${sessionDbId} (${current?.agent_type}), ${current?.status} -> completed (feature ${featureId})`);
        await AppRuntime.runPromise(execute(
          "UPDATE agent_sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
          sessionDbId,
        ));
        notifyDbUpdated("agent_session", featureId);

        // After any execute/qa/review agent completes, chain via callback
        if (onAgentDone && ["execute", "qa", "review"].includes(current?.agent_type ?? "")) {
          try {
            const wfFeat = await AppRuntime.runPromise(queryOne<{ project_id: number }>(
              "SELECT project_id FROM features WHERE id = ?",
              featureId,
            ));
            if (wfFeat) {
              const { cwd, worktreePath } = Effect.runSync(resolveAgentCwd(featureId, wfFeat.project_id));
              onAgentDone({ featureId, projectId: wfFeat.project_id, cwd, worktreePath: worktreePath ?? null });
            }
          } catch { /* */ }
        }

        return textResult("Agent marked as done. Session completed.");
      } catch (e) {
        return errorResult(`Failed to mark agent done: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Reusable phase-status tool: agents mark their own phase as completed
// ---------------------------------------------------------------------------

export function createMarkPhaseDoneTool(featureId: number) {
  return tool(
    "mark_phase_done",
    "Mark a phase as completed. Call this after successfully finishing your work on the phase.",
    {
      phase_id: z.number().describe("The phase ID"),
      implementation_notes: z.string().optional().describe("Summary of what was implemented or tested"),
      deviations: z.string().optional().describe("Any deviations from the original plan"),
    },
    async (args) => {
      try {
        const phase = await AppRuntime.runPromise(queryOne<{ status: string }>(
          "SELECT status FROM phases WHERE id = ?",
          args.phase_id,
        ));
        if (phase === null) return errorResult(`Phase ${args.phase_id} not found`);
        if (phase.status !== "running") {
          return errorResult(`Phase ${args.phase_id} has status '${phase.status}', expected 'running'`);
        }

        transitionPhase(args.phase_id, "completed", featureId, {
          implementation_notes: args.implementation_notes ?? null,
          deviations: args.deviations ?? null,
        });
        return textResult(`Phase ${args.phase_id} marked as completed`);
      } catch (e) {
        return errorResult(`Failed to mark phase done: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Shared finalize_phases tool factory (used by QA, review, risk agents)
// ---------------------------------------------------------------------------

export function createFinalizePhasesTool(planId: number, featureId: number, label: string) {
  return tool(
    "finalize_phases",
    `Finalize all draft ${label} created during this step — sets them to 'pending' so the execute orchestrator picks them up.`,
    {
      plan_id: z.number().describe("The plan ID"),
    },
    async (args) => {
      if (args.plan_id !== planId) {
        return errorResult(`Expected plan_id ${planId}, got ${args.plan_id}`);
      }

      try {
        const draftPhases = await AppRuntime.runPromise(queryAll<{ id: number; title: string; step_number: number }>(
          "SELECT id, title, step_number FROM phases WHERE plan_id = ? AND status = 'draft' ORDER BY step_number, order_index",
          planId,
        ));

        if (draftPhases.length === 0) return errorResult("No draft phases to finalize");

        await AppRuntime.runPromise(execute(
          "UPDATE phases SET status = 'pending' WHERE plan_id = ? AND status = 'draft'",
          planId,
        ));
        await AppRuntime.runPromise(execute(
          "UPDATE features SET status = 'in-progress' WHERE id = ?",
          featureId,
        ));
        await AppRuntime.runPromise(execute(
          "UPDATE plans SET status = 'active', updated_at = datetime('now') WHERE id = ?",
          planId,
        ));
        notifyDbUpdated("phase", featureId);

        const listing = draftPhases.map((p) => `- Phase ${p.id}: "${p.title}" (step ${p.step_number})`).join("\n");
        return textResult(`Finalized ${draftPhases.length} ${label}:\n${listing}`);
      } catch (e) {
        return errorResult(`Failed to finalize phases: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
}
