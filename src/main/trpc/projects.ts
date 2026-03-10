import { z } from "zod";
import path from "node:path";
import { Effect } from "effect";
import { dialog } from "electron";
import { router, publicProcedure } from "./trpc";
import { queryOne, queryAll, execute, transaction } from "../db/query";
import type { ProjectRow, SettingRow } from "../db/types";
import type { AgentType } from "../agents/types";
import { AppRuntime } from "../effect/runtime";

export const projectsRouter = router({
  selectFolder: publicProcedure.mutation(async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    const name = path.basename(folderPath);
    return { name, path: folderPath };
  }),

  list: publicProcedure.query(async () => {
    return await AppRuntime.runPromise(queryAll<ProjectRow>(
      "SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC",
    ));
  }),

  create: publicProcedure
    .input(z.object({ name: z.string(), path: z.string() }))
    .mutation(async ({ input }) => {
      const result = await AppRuntime.runPromise(execute(
        "INSERT INTO projects (name, path) VALUES (?, ?)",
        input.name, input.path,
      ));
      return { id: result.lastInsertRowid };
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const features = await AppRuntime.runPromise(queryAll<{ id: number }>(
      "SELECT id FROM features WHERE project_id = ?",
      input.id,
    ));
    const featureIds = features.map((f) => f.id);

    // NOTE: Effect.runSync is intentionally used inside this transaction callback.
    // better-sqlite3 transactions require a synchronous callback — they cannot be
    // async or Promise-based. Because all our DB query/execute helpers are
    // synchronous under the hood (better-sqlite3 is fully synchronous), wrapping
    // them with Effect.runSync is safe here.
    //
    // If any Effect.runSync call throws (e.g. a DatabaseError), the exception
    // propagates out of the transaction callback and better-sqlite3 automatically
    // rolls back the entire transaction — so partial writes are never committed.
    //
    // This is not a mistake or an anti-pattern; it is the correct way to perform
    // multi-step atomic deletes with our Effect-based DB helpers inside a
    // synchronous better-sqlite3 transaction.
    await AppRuntime.runPromise(transaction(() => {
      if (featureIds.length > 0) {
        const ph = featureIds.map(() => "?").join(",");

        // Get child IDs
        const planIds = Effect.runSync(queryAll<{ id: number }>(
          `SELECT id FROM plans WHERE feature_id IN (${ph})`, ...featureIds,
        )).map((p) => p.id);
        const sessionIds = Effect.runSync(queryAll<{ id: number }>(
          `SELECT id FROM agent_sessions WHERE feature_id IN (${ph})`, ...featureIds,
        )).map((s) => s.id);

        // Delete grandchildren
        if (sessionIds.length > 0) {
          const sp = sessionIds.map(() => "?").join(",");
          Effect.runSync(execute(`DELETE FROM agent_messages WHERE session_id IN (${sp})`, ...sessionIds));
        }
        if (planIds.length > 0) {
          const pp = planIds.map(() => "?").join(",");
          Effect.runSync(execute(`DELETE FROM phases WHERE plan_id IN (${pp})`, ...planIds));
        }

        // Delete feature children
        Effect.runSync(execute(`DELETE FROM agent_sessions WHERE feature_id IN (${ph})`, ...featureIds));
        Effect.runSync(execute(`DELETE FROM plans WHERE feature_id IN (${ph})`, ...featureIds));
        Effect.runSync(execute(`DELETE FROM feature_settings WHERE feature_id IN (${ph})`, ...featureIds));
        Effect.runSync(execute(`DELETE FROM diff_viewed_files WHERE feature_id IN (${ph})`, ...featureIds));
        Effect.runSync(execute(`DELETE FROM features WHERE project_id = ?`, input.id));
      }

      // Delete project children
      Effect.runSync(execute("DELETE FROM project_settings WHERE project_id = ?", input.id));
      Effect.runSync(execute("DELETE FROM projects WHERE id = ?", input.id));
    }));

    return { success: true };
  }),

  getSettings: publicProcedure
    .input(z.object({ project_id: z.number() }))
    .query(async ({ input }) => {
      // Combine real columns + remaining EAV rows
      const project = await AppRuntime.runPromise(queryOne<Record<string, string | null>>(
        "SELECT branch_prefix, qa_prompt, agent_autonomy, model_plan, model_prd, model_execute, model_risk, model_review, model_session, model_qa FROM projects WHERE id = ?",
        input.project_id,
      ));

      const result: Record<string, string> = {};
      if (project) {
        for (const [key, value] of Object.entries(project)) {
          if (value != null) result[key] = value;
        }
      }

      // Also include any remaining EAV rows (e.g. future keys)
      const rows = await AppRuntime.runPromise(queryAll<SettingRow>(
        "SELECT key, value FROM project_settings WHERE project_id = ?",
        input.project_id,
      ));
      for (const r of rows) {
        result[r.key] = r.value;
      }

      return result;
    }),

  setSetting: publicProcedure
    .input(z.object({ project_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(async ({ input }) => {
      const realColumns = new Set([
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_session", "model_qa", "agent_autonomy", "branch_prefix", "qa_prompt",
      ]);

      if (realColumns.has(input.key)) {
        await AppRuntime.runPromise(execute(
          `UPDATE projects SET "${input.key}" = ? WHERE id = ?`,
          input.value, input.project_id,
        ));
      } else {
        await AppRuntime.runPromise(execute(
          "INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value",
          input.project_id, input.key, input.value,
        ));
      }
      return { success: true };
    }),

  /** Get model settings for all agent types from project columns (empty string = inherit from parent) */
  getModelSettings: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const row = await AppRuntime.runPromise(queryOne<Record<string, string | null>>(
        'SELECT model_plan, model_prd, model_execute, model_risk, model_review, "model_review-fixer", model_session, model_qa, model_retro FROM projects WHERE id = ?',
        input.projectId,
      ));

      const agentTypes = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
      const result: Record<string, string> = {};
      for (const at of agentTypes) {
        result[at] = row?.[`model_${at}`] ?? "";
      }
      return result as Record<AgentType, string>;
    }),

  /** Set a model for a specific agent type in project settings */
  setModelSetting: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        agentType: z.enum(["plan", "prd", "execute", "risk", "review", "session", "qa", "review-fixer", "retro"]),
        modelId: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const col = `model_${input.agentType}`;
      await AppRuntime.runPromise(execute(
        `UPDATE projects SET "${col}" = ? WHERE id = ?`,
        input.modelId, input.projectId,
      ));
      return { success: true };
    }),
});
