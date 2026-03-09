import { z } from "zod";
import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import { queryOne, queryAll, queryAllValidated } from "../db/query";
import type { FeatureRow, PlanRow, PhaseRow, CountRow, SettingRow, ProjectRow } from "../db/types";
import { SettingRowSchema } from "../effect/schemas/db-schemas";
import type { AgentType } from "../agents/types";
import { getSubprocessIdsForSessionDbIds, notifyDbUpdated } from "../agents/effect-helpers";
import { stopSubprocess } from "../agents/subprocess-manager";
import { processNextPhase } from "../agents/execute-agent";
import { resolveAgentCwd } from "../agents/resolve-cwd";

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
    .query(({ input }) => {
      if (input.status) {
        return Effect.runSync(queryAll<FeatureRow>(
          "SELECT id, project_id, title, status, type, created_at FROM features WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          input.project_id, input.status,
        ));
      }
      return Effect.runSync(queryAll<FeatureRow>(
        "SELECT id, project_id, title, status, type, created_at FROM features WHERE project_id = ? ORDER BY created_at DESC",
        input.project_id,
      ));
    }),

  create: publicProcedure
    .input(z.object({ project_id: z.number(), title: z.string().optional() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      let title = input.title?.trim();
      if (!title) {
        const maxRow = Effect.runSync(queryOne<{ max_num: number | null }>(
          "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
          input.project_id,
        ));
        const maxNum = maxRow?.max_num ?? 0;
        title = `Session ${maxNum + 1}`;
      }
      const result = db
        .prepare("INSERT INTO features (project_id, title) VALUES (?, ?)")
        .run(input.project_id, title);
      return { id: Number(result.lastInsertRowid) };
    }),

  createSession: publicProcedure
    .input(z.object({ project_id: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const maxRow = Effect.runSync(queryOne<{ max_num: number | null }>(
        "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
        input.project_id,
      ));
      const maxNum = maxRow?.max_num ?? 0;
      const title = `Session ${maxNum + 1}`;
      const result = db
        .prepare("INSERT INTO features (project_id, title, type) VALUES (?, ?, 'session')")
        .run(input.project_id, title);
      return { id: Number(result.lastInsertRowid) };
    }),

  updateStatus: publicProcedure
    .input(z.object({ id: z.number(), status: featureStatusSchema }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("UPDATE features SET status = ? WHERE id = ?").run(input.status, input.id);
      return { success: true };
    }),

  updateTitle: publicProcedure
    .input(z.object({ id: z.number(), title: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("UPDATE features SET title = ? WHERE id = ?").run(input.title, input.id);
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDatabase();
    // Stop any running subprocesses for this feature's agent sessions
    const sessionIds = Effect.runSync(queryAll<{ id: number }>(
      "SELECT id FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused')",
      input.id,
    ));
    if (sessionIds.length > 0) {
      const subprocessIds = getSubprocessIdsForSessionDbIds(sessionIds.map((s) => s.id));
      for (const spId of subprocessIds) {
        try { await stopSubprocess(spId); } catch { /* best effort */ }
      }
    }
    // Delete child records that reference this feature
    const planIds = Effect.runSync(queryAll<{ id: number }>("SELECT id FROM plans WHERE feature_id = ?", input.id));
    for (const plan of planIds) {
      db.prepare("DELETE FROM phases WHERE plan_id = ?").run(plan.id);
    }
    db.prepare("DELETE FROM plans WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)").run(input.id);
    db.prepare("DELETE FROM agent_sessions WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM feature_settings WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM diff_comments WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM diff_viewed_files WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM features WHERE id = ?").run(input.id);
    return { success: true };
  }),

  getPrd: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const row = Effect.runSync(queryOne<{ prd: string | null }>(
        "SELECT prd FROM features WHERE id = ?",
        input.feature_id,
      ));
      return { prd: row?.prd ?? null };
    }),

  isEmpty: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const feature = Effect.runSync(queryOne<{ type: string; prd: string | null }>(
        "SELECT type, prd FROM features WHERE id = ?",
        input.id,
      ));

      if (feature === null) return { empty: true };

      // Never direct-delete if there are active (running/paused/waiting) sessions
      const activeSession = Effect.runSync(queryOne<Record<string, unknown>>(
        "SELECT 1 FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused', 'waiting') LIMIT 1",
        input.id,
      ));
      if (activeSession !== null) return { empty: false };

      if (feature.type === "session") {
        const msg = Effect.runSync(queryOne<Record<string, unknown>>(
          "SELECT 1 FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
          input.id,
        ));
        return { empty: msg === null };
      }

      const hasPrd = feature.prd != null && feature.prd.trim() !== "";
      const hasPlan = Effect.runSync(queryOne<Record<string, unknown>>(
        "SELECT 1 FROM plans WHERE feature_id = ? LIMIT 1",
        input.id,
      )) !== null;
      return { empty: !hasPrd && !hasPlan };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      return Effect.runSync(queryOne<FeatureRow>(
        "SELECT id, project_id, title, status, type, created_at FROM features WHERE id = ?",
        input.id,
      ));
    }),

  getPlanProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const plan = Effect.runSync(queryOne<Pick<PlanRow, "id">>(
        "SELECT id FROM plans WHERE feature_id = ? LIMIT 1",
        input.feature_id,
      ));
      if (plan === null) return { total: 0, done: 0 };
      const totalRow = Effect.runSync(queryOne<CountRow>(
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ?",
        plan.id,
      ));
      const doneRow = Effect.runSync(queryOne<CountRow>(
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
        plan.id,
      ));
      return { total: totalRow?.count ?? 0, done: doneRow?.count ?? 0 };
    }),

  getProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const plan = Effect.runSync(queryOne<Pick<PlanRow, "id">>(
        "SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        input.feature_id,
      ));
      if (plan === null) return { total: 0, done: 0 };
      const totalRow = Effect.runSync(queryOne<CountRow>(
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ?",
        plan.id,
      ));
      const doneRow = Effect.runSync(queryOne<CountRow>(
        "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
        plan.id,
      ));
      return { total: totalRow?.count ?? 0, done: doneRow?.count ?? 0 };
    }),

  getPlanWithPhases: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const plan = Effect.runSync(queryOne<PlanRow>(
        "SELECT id, feature_id, title, status, raw_markdown, created_at, updated_at FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        input.feature_id,
      ));
      if (plan === null) return null;
      const phases = Effect.runSync(queryAll<PhaseRow>(
        "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC",
        plan.id,
      ));
      return { ...plan, phases };
    }),

  getSettings: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const feature = db
        .prepare("SELECT model_plan, model_prd, model_execute, model_risk, model_review, model_session, model_qa, agent_autonomy, parallel_execution FROM features WHERE id = ?")
        .get(input.feature_id) as Record<string, string | null> | undefined;

      const result: Record<string, string> = {};
      if (feature) {
        for (const [key, value] of Object.entries(feature)) {
          if (value != null) result[key] = value;
        }
      }

      const rows = Effect.runSync(queryAllValidated(
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
    .mutation(({ input }) => {
      const db = getDatabase();

      const phase = Effect.runSync(queryOne<Pick<PhaseRow, "id" | "plan_id" | "step_number" | "status">>(
        "SELECT id, plan_id, step_number, status FROM phases WHERE id = ?",
        input.phase_id,
      ));
      if (phase === null) throw new Error("Phase not found");

      if (phase.status !== "completed" && phase.status !== "error") {
        throw new Error("Can only reset phases in completed or error status");
      }

      // Check that the next phase (by step_number) is not completed
      const nextPhase = Effect.runSync(queryOne<Pick<PhaseRow, "id" | "status">>(
        "SELECT id, status FROM phases WHERE plan_id = ? AND step_number > ? ORDER BY step_number ASC, order_index ASC LIMIT 1",
        phase.plan_id, phase.step_number,
      ));
      if (nextPhase !== null && nextPhase.status === "completed") {
        throw new Error("Cannot reset a phase when the next phase is already completed");
      }

      // Delete agent messages for sessions tied to this phase
      db.prepare(
        "DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE phase_id = ?)"
      ).run(input.phase_id);

      // Delete agent sessions tied to this phase
      db.prepare("DELETE FROM agent_sessions WHERE phase_id = ?").run(input.phase_id);

      // Reset phase status and clear implementation data
      db.prepare(
        "UPDATE phases SET status = 'pending', implementation_notes = NULL, deviations = NULL WHERE id = ?"
      ).run(input.phase_id);

      return { success: true };
    }),

  overridePhaseStatus: publicProcedure
    .input(z.object({
      phase_id: z.number(),
      status: z.enum(["pending", "running", "completed", "error"]),
    }))
    .mutation(({ input }) => {
      const db = getDatabase();

      const phase = Effect.runSync(queryOne<Pick<PhaseRow, "id" | "plan_id">>(
        "SELECT id, plan_id FROM phases WHERE id = ?",
        input.phase_id,
      ));
      if (phase === null) throw new Error("Phase not found");

      db.prepare("UPDATE phases SET status = ? WHERE id = ?").run(input.status, input.phase_id);

      const plan = Effect.runSync(queryOne<Pick<PlanRow, "feature_id">>(
        "SELECT feature_id FROM plans WHERE id = ?",
        phase.plan_id,
      ));
      if (plan !== null) notifyDbUpdated("phase", plan.feature_id);

      return { success: true };
    }),

  setSetting: publicProcedure
    .input(z.object({ feature_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const realColumns = new Set([
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_session", "model_qa", "agent_autonomy", "parallel_execution",
      ]);

      if (realColumns.has(input.key)) {
        db.prepare(`UPDATE features SET "${input.key}" = ? WHERE id = ?`)
          .run(input.value, input.feature_id);
      } else {
        db.prepare(
          "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
        ).run(input.feature_id, input.key, input.value);
      }

      // When autonomy is raised to >= 2, resume execution if feature is in-progress
      if (input.key === "agent_autonomy" && Number(input.value) >= 2) {
        const feat = Effect.runSync(queryOne<{ status: string; project_id: number }>(
          "SELECT status, project_id FROM features WHERE id = ?",
          input.feature_id,
        ));
        if (feat && feat.status === "in-progress") {
          resolveAgentCwd(input.feature_id, feat.project_id)
            .then(({ cwd, worktreePath }) => {
              processNextPhase({ featureId: input.feature_id, projectId: feat.project_id, cwd, worktreePath });
            })
            .catch(() => { /* */ });
        }
      }

      return { success: true };
    }),

  getModelSettings: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const row = Effect.runSync(queryOne<Record<string, string | null>>(
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
    .mutation(({ input }) => {
      const db = getDatabase();
      const col = `model_${input.agentType}`;
      db.prepare(`UPDATE features SET "${col}" = ? WHERE id = ?`)
        .run(input.modelId, input.featureId);
      return { success: true };
    }),

  resolveWorkingDir: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .query(({ input }) => {
      const feature = Effect.runSync(queryOne<{ type: string }>(
        "SELECT type FROM features WHERE id = ?",
        input.featureId,
      ));

      if (feature !== null && feature.type !== "session") {
        const setting = Effect.runSync(queryOne<Pick<SettingRow, "value">>(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
          input.featureId,
        ));
        if (setting !== null) return setting.value;
      }

      const project = Effect.runSync(queryOne<Pick<ProjectRow, "path">>(
        "SELECT path FROM projects WHERE id = ?",
        input.projectId,
      ));
      return project?.path ?? null;
    }),
});
