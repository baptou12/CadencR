import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./trpc";
import { queryOne, queryAll, queryOneValidated, queryAllValidated, execute, transaction } from "../db/query";
import { Effect } from "effect";
import type { PlanRow, PhaseRow, SettingRow, ProjectRow } from "../db/types";
import { SettingRowSchema, FeatureRowSchema, PlanRowSchema, PhaseRowSchema, CountRowSchema } from "../effect/schemas/db-schemas";
import type { AgentType } from "../agents/types";
import { getSubprocessIdsForSessionDbIds, notifyDbUpdated } from "../agents/effect-helpers";
import { stopSubprocess } from "../agents/subprocess-manager";
import { processNextPhase } from "../agents/execute-agent";
import { resolveAgentCwd } from "../agents/resolve-cwd";
import { AppRuntime } from "../effect/runtime";

export const FEATURE_STATUSES = ["draft", "planned", "in-progress", "done", "archived"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

const featureStatusSchema = z.enum(FEATURE_STATUSES);

export const featuresRouter = router({
  listByProject: publicProcedure
    .input(
      z.object({
        project_id: z.number(),
        status: featureStatusSchema.optional(),
      }),
    )
    .query(async ({ input }) => {
      if (input.status) {
        return await AppRuntime.runPromise(queryAllValidated(
          FeatureRowSchema,
          "SELECT * FROM features WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          input.project_id, input.status,
        ));
      }
      return await AppRuntime.runPromise(queryAllValidated(
        FeatureRowSchema,
        "SELECT * FROM features WHERE project_id = ? ORDER BY created_at DESC",
        input.project_id,
      ));
    }),

  create: publicProcedure
    .input(z.object({ project_id: z.number(), title: z.string().optional() }))
    .mutation(async ({ input }) => {
      let title = input.title?.trim();
      if (!title) {
        const maxRow = await AppRuntime.runPromise(queryOne<{ max_num: number | null }>(
          "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
          input.project_id,
        ));
        const maxNum = maxRow?.max_num ?? 0;
        title = `Session ${maxNum + 1}`;
      }
      const result = await AppRuntime.runPromise(execute(
        "INSERT INTO features (project_id, title) VALUES (?, ?)",
        input.project_id, title,
      ));
      return { id: result.lastInsertRowid };
    }),

  createSession: publicProcedure
    .input(z.object({ project_id: z.number() }))
    .mutation(async ({ input }) => {
      const maxRow = await AppRuntime.runPromise(queryOne<{ max_num: number | null }>(
        "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
        input.project_id,
      ));
      const maxNum = maxRow?.max_num ?? 0;
      const title = `Session ${maxNum + 1}`;
      const result = await AppRuntime.runPromise(execute(
        "INSERT INTO features (project_id, title, type) VALUES (?, ?, 'session')",
        input.project_id, title,
      ));
      return { id: result.lastInsertRowid };
    }),

  updateStatus: publicProcedure
    .input(z.object({ id: z.number(), status: featureStatusSchema }))
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute("UPDATE features SET status = ? WHERE id = ?", input.status, input.id));
      return { success: true };
    }),

  updateTitle: publicProcedure
    .input(z.object({ id: z.number(), title: z.string() }))
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute("UPDATE features SET title = ? WHERE id = ?", input.title, input.id));
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    // Stop any running subprocesses for this feature's agent sessions
    const sessionIds = await AppRuntime.runPromise(queryAll<{ id: number }>(
      "SELECT id FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused')",
      input.id,
    ));
    if (sessionIds.length > 0) {
      const subprocessIds = getSubprocessIdsForSessionDbIds(sessionIds.map((s) => s.id));
      for (const spId of subprocessIds) {
        try { await stopSubprocess(spId); } catch { /* best effort */ }
      }
    }
    // Delete child records that reference this feature.
    // Effect.runSync is used inside the transaction callback because better-sqlite3
    // transactions are synchronous — this is not a mistake or anti-pattern; it is
    // the correct way to perform multi-step atomic deletes with our Effect-based DB
    // helpers inside a synchronous better-sqlite3 transaction.
    await AppRuntime.runPromise(transaction(() => {
      const planIds = Effect.runSync(queryAll<{ id: number }>("SELECT id FROM plans WHERE feature_id = ?", input.id));
      for (const plan of planIds) {
        Effect.runSync(execute("DELETE FROM phases WHERE plan_id = ?", plan.id));
      }
      Effect.runSync(execute("DELETE FROM plans WHERE feature_id = ?", input.id));
      Effect.runSync(execute("DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)", input.id));
      Effect.runSync(execute("DELETE FROM agent_sessions WHERE feature_id = ?", input.id));
      Effect.runSync(execute("DELETE FROM feature_settings WHERE feature_id = ?", input.id));
      Effect.runSync(execute("DELETE FROM diff_comments WHERE feature_id = ?", input.id));
      Effect.runSync(execute("DELETE FROM diff_viewed_files WHERE feature_id = ?", input.id));
      Effect.runSync(execute("DELETE FROM features WHERE id = ?", input.id));
    }));
    return { success: true };
  }),

  getPrd: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(async ({ input }) => {
      const row = await AppRuntime.runPromise(queryOne<{ prd: string | null }>(
        "SELECT prd FROM features WHERE id = ?",
        input.feature_id,
      ));
      return { prd: row?.prd ?? null };
    }),

  isEmpty: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const feature = await AppRuntime.runPromise(queryOne<{ type: string; prd: string | null }>(
        "SELECT type, prd FROM features WHERE id = ?",
        input.id,
      ));

      if (feature === null) return { empty: true };

      // Never direct-delete if there are active (running/paused/waiting) sessions
      const activeSession = await AppRuntime.runPromise(queryOne<Record<string, unknown>>(
        "SELECT 1 FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused', 'waiting') LIMIT 1",
        input.id,
      ));
      if (activeSession !== null) return { empty: false };

      if (feature.type === "session") {
        const msg = await AppRuntime.runPromise(queryOne<Record<string, unknown>>(
          "SELECT 1 FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
          input.id,
        ));
        return { empty: msg === null };
      }

      const hasPrd = feature.prd != null && feature.prd.trim() !== "";
      const hasPlan = await AppRuntime.runPromise(queryOne<Record<string, unknown>>(
        "SELECT 1 FROM plans WHERE feature_id = ? LIMIT 1",
        input.id,
      )) !== null;
      return { empty: !hasPrd && !hasPlan };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return await AppRuntime.runPromise(queryOneValidated(
        FeatureRowSchema,
        "SELECT * FROM features WHERE id = ?",
        input.id,
      ));
    }),

  getPlanProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(async ({ input }) => {
      const plan = await AppRuntime.runPromise(queryOne<Pick<PlanRow, "id">>(
        "SELECT id FROM plans WHERE feature_id = ? LIMIT 1",
        input.feature_id,
      ));
      if (plan === null) return { total: 0, done: 0 };
      const totalRow = await AppRuntime.runPromise(queryOneValidated(
        CountRowSchema,
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ?",
        plan.id,
      ));
      const doneRow = await AppRuntime.runPromise(queryOneValidated(
        CountRowSchema,
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
        plan.id,
      ));
      return { total: totalRow?.count ?? 0, done: doneRow?.count ?? 0 };
    }),

  getProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(async ({ input }) => {
      const plan = await AppRuntime.runPromise(queryOne<Pick<PlanRow, "id">>(
        "SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        input.feature_id,
      ));
      if (plan === null) return { total: 0, done: 0 };
      const totalRow = await AppRuntime.runPromise(queryOneValidated(
        CountRowSchema,
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ?",
        plan.id,
      ));
      const doneRow = await AppRuntime.runPromise(queryOneValidated(
        CountRowSchema,
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
        plan.id,
      ));
      return { total: totalRow?.count ?? 0, done: doneRow?.count ?? 0 };
    }),

  getPlanWithPhases: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(async ({ input }) => {
      const plan = await AppRuntime.runPromise(queryOneValidated(
        PlanRowSchema,
        "SELECT * FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        input.feature_id,
      ));
      if (plan === null) return null;
      const phases = await AppRuntime.runPromise(queryAllValidated(
        PhaseRowSchema,
        "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC",
        plan.id,
      ));
      return { ...plan, phases };
    }),

  getSettings: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(async ({ input }) => {
      const feature = await AppRuntime.runPromise(queryOne<Record<string, string | null>>(
        "SELECT model_plan, model_prd, model_execute, model_risk, model_review, model_session, model_qa, agent_autonomy, parallel_execution FROM features WHERE id = ?",
        input.feature_id,
      ));

      const result: Record<string, string> = {};
      if (feature) {
        for (const [key, value] of Object.entries(feature)) {
          if (value != null) result[key] = value;
        }
      }

      const rows = await AppRuntime.runPromise(queryAllValidated(
        SettingRowSchema,
        "SELECT key, value FROM feature_settings WHERE feature_id = ?",
        input.feature_id,
      ));
      for (const r of rows) {
        result[r.key] = r.value;
      }
      return result;
    }),

  resetPhase: publicProcedure
    .input(z.object({ phase_id: z.number() }))
    .mutation(async ({ input }) => {
      const phase = await AppRuntime.runPromise(queryOne<Pick<PhaseRow, "id" | "plan_id" | "step_number" | "status">>(
        "SELECT id, plan_id, step_number, status FROM phases WHERE id = ?",
        input.phase_id,
      ));
      if (phase === null) throw new TRPCError({ code: "NOT_FOUND", message: `Phase ${input.phase_id} not found` });

      if (phase.status !== "completed" && phase.status !== "error") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only reset phases in completed or error status" });
      }

      // Check that the next phase (by step_number) is not completed
      const nextPhase = await AppRuntime.runPromise(queryOne<Pick<PhaseRow, "id" | "status">>(
        "SELECT id, status FROM phases WHERE plan_id = ? AND step_number > ? ORDER BY step_number ASC, order_index ASC LIMIT 1",
        phase.plan_id, phase.step_number,
      ));
      if (nextPhase !== null && nextPhase.status === "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reset a phase when the next phase is already completed" });
      }

      // Atomically delete sessions/messages and reset the phase status.
      // Effect.runSync is used inside the transaction callback because better-sqlite3
      // transactions are synchronous — this is not a mistake or anti-pattern; it is
      // the correct way to perform multi-step atomic mutations with our Effect-based
      // DB helpers inside a synchronous better-sqlite3 transaction.
      await AppRuntime.runPromise(transaction(() => {
        // Delete agent messages for sessions tied to this phase
        Effect.runSync(execute(
          "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE phase_id = ?)",
          input.phase_id,
        ));
        // Delete agent sessions tied to this phase
        Effect.runSync(execute("DELETE FROM agent_sessions WHERE phase_id = ?", input.phase_id));
        // Reset phase status and clear implementation data
        Effect.runSync(execute(
          "UPDATE phases SET status = 'pending', implementation_notes = NULL, deviations = NULL WHERE id = ?",
          input.phase_id,
        ));
      }));

      return { success: true };
    }),

  overridePhaseStatus: publicProcedure
    .input(z.object({
      phase_id: z.number(),
      status: z.enum(["pending", "running", "completed", "error"]),
    }))
    .mutation(async ({ input }) => {
      const phase = await AppRuntime.runPromise(queryOne<Pick<PhaseRow, "id" | "plan_id">>(
        "SELECT id, plan_id FROM phases WHERE id = ?",
        input.phase_id,
      ));
      if (phase === null) throw new TRPCError({ code: "NOT_FOUND", message: `Phase ${input.phase_id} not found` });

      await AppRuntime.runPromise(execute("UPDATE phases SET status = ? WHERE id = ?", input.status, input.phase_id));

      const plan = await AppRuntime.runPromise(queryOne<Pick<PlanRow, "feature_id">>(
        "SELECT feature_id FROM plans WHERE id = ?",
        phase.plan_id,
      ));
      if (plan !== null) notifyDbUpdated("phase", plan.feature_id);

      return { success: true };
    }),

  setSetting: publicProcedure
    .input(z.object({ feature_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(async ({ input }) => {
      const realColumns = new Set([
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_session", "model_qa", "agent_autonomy", "parallel_execution",
      ]);

      if (realColumns.has(input.key)) {
        await AppRuntime.runPromise(execute(
          `UPDATE features SET "${input.key}" = ? WHERE id = ?`,
          input.value, input.feature_id,
        ));
      } else {
        await AppRuntime.runPromise(execute(
          "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
          input.feature_id, input.key, input.value,
        ));
      }

      // When autonomy is raised to >= 2, resume execution if feature is in-progress
      if (input.key === "agent_autonomy" && Number(input.value) >= 2) {
        const feat = await AppRuntime.runPromise(queryOne<{ status: string; project_id: number }>(
          "SELECT status, project_id FROM features WHERE id = ?",
          input.feature_id,
        ));
        if (feat && feat.status === "in-progress") {
          try {
            const { cwd, worktreePath } = Effect.runSync(resolveAgentCwd(input.feature_id, feat.project_id));
            processNextPhase({ featureId: input.feature_id, projectId: feat.project_id, cwd, worktreePath });
          } catch { /* */ }
        }
      }

      return { success: true };
    }),

  getModelSettings: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      const row = await AppRuntime.runPromise(queryOne<Record<string, string | null>>(
        'SELECT model_plan, model_prd, model_execute, model_risk, model_review, "model_review-fixer", model_session, model_qa, model_retro FROM features WHERE id = ?',
        input.featureId,
      ));

      const agentTypes = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
      const result: Record<string, string> = {};
      for (const at of agentTypes) {
        result[at] = row?.[`model_${at}`] ?? "";
      }
      return result as Record<AgentType, string>;
    }),

  setModelSetting: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        agentType: z.enum(["plan", "prd", "execute", "risk", "review", "session", "qa", "review-fixer", "retro"]),
        modelId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const col = `model_${input.agentType}`;
      await AppRuntime.runPromise(execute(
        `UPDATE features SET "${col}" = ? WHERE id = ?`,
        input.modelId, input.featureId,
      ));
      return { success: true };
    }),

  resolveWorkingDir: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .query(async ({ input }) => {
      const feature = await AppRuntime.runPromise(queryOne<{ type: string }>(
        "SELECT type FROM features WHERE id = ?",
        input.featureId,
      ));

      if (feature !== null && feature.type !== "session") {
        const setting = await AppRuntime.runPromise(queryOne<Pick<SettingRow, "value">>(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
          input.featureId,
        ));
        if (setting !== null) return setting.value;
      }

      const project = await AppRuntime.runPromise(queryOne<Pick<ProjectRow, "path">>(
        "SELECT path FROM projects WHERE id = ?",
        input.projectId,
      ));
      return project?.path ?? null;
    }),
});
