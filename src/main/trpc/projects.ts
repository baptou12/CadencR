import { z } from "zod";
import path from "node:path";
import { dialog } from "electron";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { ProjectRow, SettingRow } from "../db/types";
import type { AgentType } from "../agents/types";

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

  list: publicProcedure.query(() => {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC")
      .all() as ProjectRow[];
    return rows;
  }),

  create: publicProcedure
    .input(z.object({ name: z.string(), path: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const result = db
        .prepare("INSERT INTO projects (name, path) VALUES (?, ?)")
        .run(input.name, input.path);
      return { id: Number(result.lastInsertRowid) };
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDatabase();

    const features = db
      .prepare("SELECT id FROM features WHERE project_id = ?")
      .all(input.id) as { id: number }[];
    const featureIds = features.map((f) => f.id);

    const transaction = db.transaction(() => {
      if (featureIds.length > 0) {
        const ph = featureIds.map(() => "?").join(",");

        // Get child IDs
        const planIds = (
          db.prepare(`SELECT id FROM plans WHERE feature_id IN (${ph})`).all(...featureIds) as { id: number }[]
        ).map((p) => p.id);
        const sessionIds = (
          db.prepare(`SELECT id FROM agent_sessions WHERE feature_id IN (${ph})`).all(...featureIds) as { id: number }[]
        ).map((s) => s.id);

        // Delete grandchildren
        if (sessionIds.length > 0) {
          const sp = sessionIds.map(() => "?").join(",");
          db.prepare(`DELETE FROM agent_messages WHERE session_id IN (${sp})`).run(...sessionIds);
        }
        if (planIds.length > 0) {
          const pp = planIds.map(() => "?").join(",");
          db.prepare(`DELETE FROM phases WHERE plan_id IN (${pp})`).run(...planIds);
        }

        // Delete feature children
        db.prepare(`DELETE FROM agent_sessions WHERE feature_id IN (${ph})`).run(...featureIds);
        db.prepare(`DELETE FROM plans WHERE feature_id IN (${ph})`).run(...featureIds);
        db.prepare(`DELETE FROM feature_settings WHERE feature_id IN (${ph})`).run(...featureIds);
        db.prepare(`DELETE FROM diff_viewed_files WHERE feature_id IN (${ph})`).run(...featureIds);
        db.prepare(`DELETE FROM features WHERE project_id = ?`).run(input.id);
      }

      // Delete project children
      db.prepare("DELETE FROM project_settings WHERE project_id = ?").run(input.id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(input.id);
    });

    transaction();
    return { success: true };
  }),

  getSettings: publicProcedure
    .input(z.object({ project_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      // Combine real columns + remaining EAV rows
      const project = db
        .prepare("SELECT branch_prefix, qa_prompt, agent_autonomy, model_plan, model_prd, model_execute, model_risk, model_review, model_session, model_qa FROM projects WHERE id = ?")
        .get(input.project_id) as Record<string, string | null> | undefined;

      const result: Record<string, string> = {};
      if (project) {
        for (const [key, value] of Object.entries(project)) {
          if (value != null) result[key] = value;
        }
      }

      // Also include any remaining EAV rows (e.g. future keys)
      const rows = db
        .prepare("SELECT key, value FROM project_settings WHERE project_id = ?")
        .all(input.project_id) as SettingRow[];
      for (const r of rows) {
        result[r.key] = r.value;
      }

      return result;
    }),

  setSetting: publicProcedure
    .input(z.object({ project_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const realColumns = new Set([
        "model_plan", "model_prd", "model_execute", "model_risk", "model_review",
        "model_session", "model_qa", "agent_autonomy", "branch_prefix", "qa_prompt",
      ]);

      if (realColumns.has(input.key)) {
        db.prepare(`UPDATE projects SET "${input.key}" = ? WHERE id = ?`)
          .run(input.value, input.project_id);
      } else {
        db.prepare(
          "INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value",
        ).run(input.project_id, input.key, input.value);
      }
      return { success: true };
    }),

  /** Get model settings for all agent types from project columns (empty string = inherit from parent) */
  getModelSettings: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const row = db
        .prepare("SELECT model_plan, model_prd, model_execute, model_risk, model_review, model_session, model_qa FROM projects WHERE id = ?")
        .get(input.projectId) as Record<string, string | null> | undefined;

      const agentTypes = ["plan", "prd", "execute", "risk", "review", "session", "qa"] as const;
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
    .mutation(({ input }) => {
      const db = getDatabase();
      const col = `model_${input.agentType}`;
      db.prepare(`UPDATE projects SET "${col}" = ? WHERE id = ?`)
        .run(input.modelId, input.projectId);
      return { success: true };
    }),
});
