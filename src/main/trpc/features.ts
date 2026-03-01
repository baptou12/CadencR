import { z } from "zod";
import { Option } from "@swan-io/boxed";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import { queryOne, queryAll } from "../db/query";
import type { FeatureRow, PlanRow, PhaseRow, CountRow, SettingRow, ProjectRow } from "../db/types";
import type { AgentType } from "../agents/types";
import { getSubprocessIdsForSessionDbIds, notifyDbUpdated } from "../agents/session-persistence";
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
        return queryAll<FeatureRow>(
          "SELECT id, project_id, title, status, type, created_at FROM features WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          input.project_id, input.status,
        ).getOr([]);
      }
      return queryAll<FeatureRow>(
        "SELECT id, project_id, title, status, type, created_at FROM features WHERE project_id = ? ORDER BY created_at DESC",
        input.project_id,
      ).getOr([]);
    }),

  create: publicProcedure
    .input(z.object({ project_id: z.number(), title: z.string().optional() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      let title = input.title?.trim();
      if (!title) {
        const maxNum = queryOne<{ max_num: number | null }>(
          "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
          input.project_id,
        ).map((r) => r.max_num ?? 0).getOr(0);
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
      const maxNum = queryOne<{ max_num: number | null }>(
        "SELECT MAX(CAST(REPLACE(title, 'Session ', '') AS INTEGER)) as max_num FROM features WHERE project_id = ? AND title LIKE 'Session %'",
        input.project_id,
      ).map((r) => r.max_num ?? 0).getOr(0);
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
    const sessionIds = queryAll<{ id: number }>(
      "SELECT id FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused')",
      input.id,
    ).getOr([]);
    if (sessionIds.length > 0) {
      const subprocessIds = getSubprocessIdsForSessionDbIds(sessionIds.map((s) => s.id));
      for (const spId of subprocessIds) {
        try { await stopSubprocess(spId); } catch { /* best effort */ }
      }
    }
    // Delete child records that reference this feature
    const planIds = queryAll<{ id: number }>("SELECT id FROM plans WHERE feature_id = ?", input.id).getOr([]);
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
      const prd = queryOne<{ prd: string | null }>(
        "SELECT prd FROM features WHERE id = ?",
        input.feature_id,
      ).flatMap((r) => Option.fromNullable(r.prd));
      return { prd: prd.toNull() };
    }),

  isEmpty: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      return queryOne<{ type: string; prd: string | null }>(
        "SELECT type, prd FROM features WHERE id = ?",
        input.id,
      ).match({
        None: () => ({ empty: true }),
        Some: (feature) => {
          // Never direct-delete if there are active (running/paused/waiting) sessions
          const activeSession = queryOne<Record<string, unknown>>(
            "SELECT 1 FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused', 'waiting') LIMIT 1",
            input.id,
          );
          if (activeSession.isSome()) return { empty: false };

          if (feature.type === "session") {
            const msg = queryOne<Record<string, unknown>>(
              "SELECT 1 FROM agent_messages WHERE session_id IN (SELECT id FROM agent_sessions WHERE feature_id = ?) LIMIT 1",
              input.id,
            );
            return { empty: msg.isNone() };
          }

          const hasPrd = feature.prd != null && feature.prd.trim() !== "";
          const hasPlan = queryOne<Record<string, unknown>>(
            "SELECT 1 FROM plans WHERE feature_id = ? LIMIT 1",
            input.id,
          ).isSome();
          return { empty: !hasPrd && !hasPlan };
        },
      });
    }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      return queryOne<FeatureRow>(
        "SELECT id, project_id, title, status, type, created_at FROM features WHERE id = ?",
        input.id,
      ).toNull();
    }),

  getPlanProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      return queryOne<Pick<PlanRow, "id">>(
        "SELECT id FROM plans WHERE feature_id = ? LIMIT 1",
        input.feature_id,
      ).match({
        None: () => ({ total: 0, done: 0 }),
        Some: (plan) => {
          const total = queryOne<CountRow>(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ?",
            plan.id,
          ).map((r) => r.count).getOr(0);
          const done = queryOne<CountRow>(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
            plan.id,
          ).map((r) => r.count).getOr(0);
          return { total, done };
        },
      });
    }),

  getProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      return queryOne<Pick<PlanRow, "id">>(
        "SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        input.feature_id,
      ).match({
        None: () => ({ total: 0, done: 0 }),
        Some: (plan) => {
          const total = queryOne<CountRow>(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ?",
            plan.id,
          ).map((r) => r.count).getOr(0);
          const done = queryOne<CountRow>(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'completed'",
            plan.id,
          ).map((r) => r.count).getOr(0);
          return { total, done };
        },
      });
    }),

  getPlanWithPhases: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      return queryOne<PlanRow>(
        "SELECT id, feature_id, title, status, raw_markdown, created_at, updated_at FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1",
        input.feature_id,
      ).match({
        None: () => null,
        Some: (plan) => {
          const phases = queryAll<PhaseRow>(
            "SELECT id, plan_id, step_number, title, status, complexity, commit_message, prompt, order_index, implementation_notes, deviations, phase_type FROM phases WHERE plan_id = ? ORDER BY step_number ASC, order_index ASC",
            plan.id,
          ).getOr([]);
          return { ...plan, phases };
        },
      });
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

      const rows = queryAll<SettingRow>(
        "SELECT key, value FROM feature_settings WHERE feature_id = ?",
        input.feature_id,
      ).getOr([]);
      for (const r of rows) {
        result[r.key] = r.value;
      }
      return result;
    }),

  resetPhase: publicProcedure
    .input(z.object({ phase_id: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();

      const phase = queryOne<Pick<PhaseRow, "id" | "plan_id" | "step_number" | "status">>(
        "SELECT id, plan_id, step_number, status FROM phases WHERE id = ?",
        input.phase_id,
      ).toResult("Phase not found").match({
        Error: (msg) => { throw new Error(msg); },
        Ok: (v) => v,
      });

      if (phase.status !== "completed" && phase.status !== "error") {
        throw new Error("Can only reset phases in completed or error status");
      }

      // Check that the next phase (by step_number) is not completed
      const nextPhase = queryOne<Pick<PhaseRow, "id" | "status">>(
        "SELECT id, status FROM phases WHERE plan_id = ? AND step_number > ? ORDER BY step_number ASC, order_index ASC LIMIT 1",
        phase.plan_id, phase.step_number,
      );
      if (nextPhase.isSome() && nextPhase.get().status === "completed") {
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

      const phase = queryOne<Pick<PhaseRow, "id" | "plan_id">>(
        "SELECT id, plan_id FROM phases WHERE id = ?",
        input.phase_id,
      ).toResult("Phase not found").match({
        Error: (msg) => { throw new Error(msg); },
        Ok: (v) => v,
      });

      db.prepare("UPDATE phases SET status = ? WHERE id = ?").run(input.status, input.phase_id);

      queryOne<Pick<PlanRow, "feature_id">>(
        "SELECT feature_id FROM plans WHERE id = ?",
        phase.plan_id,
      ).tapSome((plan) => notifyDbUpdated("phase", plan.feature_id));

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
        queryOne<{ status: string; project_id: number }>(
          "SELECT status, project_id FROM features WHERE id = ?",
          input.feature_id,
        ).tapSome((feat) => {
          if (feat.status === "in-progress") {
            try {
              const { cwd, worktreePath } = resolveAgentCwd(input.feature_id, feat.project_id);
              processNextPhase({ featureId: input.feature_id, projectId: feat.project_id, cwd, worktreePath });
            } catch { /* */ }
          }
        });
      }

      return { success: true };
    }),

  getModelSettings: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const row = queryOne<Record<string, string | null>>(
        "SELECT model_plan, model_prd, model_execute, model_risk, model_review, model_session, model_qa FROM features WHERE id = ?",
        input.featureId,
      );

      const agentTypes = ["plan", "prd", "execute", "risk", "review", "session", "qa"] as const;
      const result: Record<string, string> = {};
      for (const at of agentTypes) {
        result[at] = row.map((r) => r[`model_${at}`] ?? "").getOr("");
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
      return queryOne<{ type: string }>(
        "SELECT type FROM features WHERE id = ?",
        input.featureId,
      ).flatMap((feature) => {
        if (feature.type !== "session") {
          return queryOne<SettingRow>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            input.featureId,
          ).map((r) => r.value);
        }
        return Option.None();
      }).match({
        Some: (path) => path,
        None: () => {
          return queryOne<Pick<ProjectRow, "path">>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          ).map((p) => p.path).toNull();
        },
      });
    }),
});
