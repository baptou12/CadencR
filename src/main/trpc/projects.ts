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
    db.prepare("DELETE FROM projects WHERE id = ?").run(input.id);
    return { success: true };
  }),

  getSettings: publicProcedure
    .input(z.object({ project_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      // Combine real columns + remaining EAV rows
      const project = db
        .prepare("SELECT branch_prefix, qa_prompt, agent_autonomy, model_plan, model_brainstorm, model_execute, model_risk, model_review, model_session, model_qa FROM projects WHERE id = ?")
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
        "model_plan", "model_brainstorm", "model_execute", "model_risk", "model_review",
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
        .prepare("SELECT model_plan, model_brainstorm, model_execute, model_risk, model_review, model_session, model_qa FROM projects WHERE id = ?")
        .get(input.projectId) as Record<string, string | null> | undefined;

      const agentTypes = ["plan", "brainstorm", "execute", "risk", "review"] as const;
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
        agentType: z.enum(["plan", "brainstorm", "execute", "risk", "review", "qa"]),
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
