import { z } from "zod";
import path from "node:path";
import { dialog } from "electron";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { ProjectRow, SettingRow } from "../db/types";

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
      const rows = db
        .prepare("SELECT key, value FROM project_settings WHERE project_id = ?")
        .all(input.project_id) as SettingRow[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }),

  setSetting: publicProcedure
    .input(z.object({ project_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.project_id, input.key, input.value);
      return { success: true };
    }),
});
