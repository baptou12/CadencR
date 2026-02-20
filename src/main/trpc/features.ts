import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { FeatureRow, PlanRow, PhaseRow, CountRow, SettingRow } from "../db/types";
import type { AgentType } from "../agents/types";
import { getSubprocessIdsForSessionDbIds } from "../agents/session-persistence";
import { stopSubprocess } from "../agents/subprocess-manager";

export const FEATURE_STATUSES = ["draft", "planned", "in-progress", "review", "done"] as const;
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
      const db = getDatabase();
      if (input.status) {
        return db
          .prepare(
            "SELECT id, project_id, title, status, type, created_at FROM features WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(input.project_id, input.status) as FeatureRow[];
      }
      return db
        .prepare(
          "SELECT id, project_id, title, status, type, created_at FROM features WHERE project_id = ? ORDER BY created_at DESC",
        )
        .all(input.project_id) as FeatureRow[];
    }),

  create: publicProcedure
    .input(z.object({ project_id: z.number(), title: z.string().optional() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      let title = input.title?.trim();
      if (!title) {
        // Auto-generate "Session X" using unified counter across both feature types
        const maxRow = db
          .prepare(
            "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
          )
          .get(input.project_id) as { max_num: number | null };
        title = `Session ${(maxRow.max_num ?? 0) + 1}`;
      }
      const result = db
        .prepare("INSERT INTO features (project_id, title) VALUES (?, ?)")
        .run(input.project_id, title);
      const featureId = Number(result.lastInsertRowid);
      return { id: featureId };
    }),

  createSession: publicProcedure
    .input(z.object({ project_id: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      // Use MAX to extract the highest session number so deletions don't cause collisions
      // Unified counter across both feature types
      const maxRow = db
        .prepare(
          "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
        )
        .get(input.project_id) as { max_num: number | null };
      const title = `Session ${(maxRow.max_num ?? 0) + 1}`;
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

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDatabase();
    // Stop any running subprocesses for this feature's agent sessions
    const sessionIds = db
      .prepare("SELECT id FROM agent_sessions WHERE feature_id = ? AND status = 'running'")
      .all(input.id) as { id: number }[];
    if (sessionIds.length > 0) {
      const subprocessIds = getSubprocessIdsForSessionDbIds(sessionIds.map((s) => s.id));
      for (const spId of subprocessIds) {
        try { stopSubprocess(spId); } catch { /* best effort */ }
      }
    }
    // Delete child records that reference this feature
    const planIds = db.prepare("SELECT id FROM plans WHERE feature_id = ?").all(input.id) as { id: number }[];
    for (const plan of planIds) {
      db.prepare("DELETE FROM phases WHERE plan_id = ?").run(plan.id);
    }
    db.prepare("DELETE FROM plans WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?)").run(input.id);
    db.prepare("DELETE FROM agent_sessions WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM feature_settings WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM diff_comments WHERE feature_id = ?").run(input.id);
    db.prepare("DELETE FROM features WHERE id = ?").run(input.id);
    return { success: true };
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      return (db
        .prepare(
          "SELECT id, project_id, title, status, type, created_at FROM features WHERE id = ?",
        )
        .get(input.id) as FeatureRow | undefined) ?? null;
    }),

  getPlanProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const plan = db
        .prepare("SELECT id FROM plans WHERE feature_id = ? LIMIT 1")
        .get(input.feature_id) as Pick<PlanRow, "id"> | undefined;
      if (!plan) {
        return { total: 0, done: 0 };
      }
      const total = (
        db.prepare("SELECT COUNT(*) as count FROM phases WHERE plan_id = ?").get(plan.id) as CountRow
      ).count;
      const done = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
          )
          .get(plan.id) as CountRow
      ).count;
      return { total, done };
    }),

  getProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const plan = db
        .prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(input.feature_id) as Pick<PlanRow, "id"> | undefined;
      if (!plan) {
        return { total: 0, done: 0 };
      }
      const total = (
        db.prepare("SELECT COUNT(*) as count FROM phases WHERE plan_id = ?").get(plan.id) as CountRow
      ).count;
      const done = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
          )
          .get(plan.id) as CountRow
      ).count;
      return { total, done };
    }),

  getPlanWithPhases: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const plan = db
        .prepare(
          "SELECT id, feature_id, title, status, raw_markdown, created_at, updated_at FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(input.feature_id) as PlanRow | undefined;
      if (!plan) return null;
      const phases = db
        .prepare(
          "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC",
        )
        .all(plan.id) as PhaseRow[];
      return { ...plan, phases };
    }),

  getSettings: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      // Combine real columns + remaining EAV rows (worktree_path, worktree_branch, etc.)
      const feature = db
        .prepare("SELECT model_plan, model_brainstorm, model_execute, model_risk, model_review, model_session, model_qa, agent_autonomy FROM features WHERE id = ?")
        .get(input.feature_id) as Record<string, string | null> | undefined;

      const result: Record<string, string> = {};
      if (feature) {
        for (const [key, value] of Object.entries(feature)) {
          if (value != null) result[key] = value;
        }
      }

      const rows = db
        .prepare("SELECT key, value FROM feature_settings WHERE feature_id = ?")
        .all(input.feature_id) as SettingRow[];
      for (const r of rows) {
        result[r.key] = r.value;
      }
      return result;
    }),

  resetPhase: publicProcedure
    .input(z.object({ phase_id: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();

      // Get the phase and its plan
      const phase = db.prepare("SELECT id, plan_id, step_number, status FROM phases WHERE id = ?").get(input.phase_id) as Pick<PhaseRow, "id" | "plan_id" | "step_number" | "status"> | undefined;
      if (!phase) throw new Error("Phase not found");
      if (phase.status !== "completed" && phase.status !== "error") {
        throw new Error("Can only reset phases in completed or error status");
      }

      // Check that the next phase (by step_number) is not completed
      const nextPhase = db.prepare(
        "SELECT id, status FROM phases WHERE plan_id = ? AND step_number > ? ORDER BY step_number ASC, order_index ASC LIMIT 1"
      ).get(phase.plan_id, phase.step_number) as Pick<PhaseRow, "id" | "status"> | undefined;
      if (nextPhase && nextPhase.status === "completed") {
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

  setSetting: publicProcedure
    .input(z.object({ feature_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const realColumns = new Set([
        "model_plan", "model_brainstorm", "model_execute", "model_risk", "model_review",
        "model_session", "model_qa", "agent_autonomy",
      ]);

      if (realColumns.has(input.key)) {
        db.prepare(`UPDATE features SET "${input.key}" = ? WHERE id = ?`)
          .run(input.value, input.feature_id);
      } else {
        db.prepare(
          "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
        ).run(input.feature_id, input.key, input.value);
      }
      return { success: true };
    }),

  /** Get model settings for all agent types from feature columns (empty string = inherit from parent) */
  getModelSettings: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const row = db
        .prepare("SELECT model_plan, model_brainstorm, model_execute, model_risk, model_review, model_session, model_qa FROM features WHERE id = ?")
        .get(input.featureId) as Record<string, string | null> | undefined;

      const agentTypes = ["plan", "brainstorm", "execute", "risk", "review", "session"] as const;
      const result: Record<string, string> = {};
      for (const at of agentTypes) {
        result[at] = row?.[`model_${at}`] ?? "";
      }
      return result as Record<AgentType, string>;
    }),

  /** Set a model for a specific agent type in feature settings */
  setModelSetting: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        agentType: z.enum(["plan", "brainstorm", "execute", "risk", "review", "session", "qa"]),
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
});
