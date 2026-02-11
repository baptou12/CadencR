import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";

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
            "SELECT id, project_id, title, status, created_at FROM features WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(input.project_id, input.status) as {
          id: number;
          project_id: number;
          title: string;
          status: FeatureStatus;
          created_at: string;
        }[];
      }
      return db
        .prepare(
          "SELECT id, project_id, title, status, created_at FROM features WHERE project_id = ? ORDER BY created_at DESC",
        )
        .all(input.project_id) as {
        id: number;
        project_id: number;
        title: string;
        status: string;
        created_at: string;
      }[];
    }),

  create: publicProcedure
    .input(z.object({ project_id: z.number(), title: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const result = db
        .prepare("INSERT INTO features (project_id, title) VALUES (?, ?)")
        .run(input.project_id, input.title);
      return { id: Number(result.lastInsertRowid) };
    }),

  updateStatus: publicProcedure
    .input(z.object({ id: z.number(), status: featureStatusSchema }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("UPDATE features SET status = ? WHERE id = ?").run(input.status, input.id);
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDatabase();
    db.prepare("DELETE FROM features WHERE id = ?").run(input.id);
    return { success: true };
  }),

  getSettings: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const rows = db
        .prepare("SELECT key, value FROM feature_settings WHERE feature_id = ?")
        .all(input.feature_id) as { key: string; value: string }[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }),

  setSetting: publicProcedure
    .input(z.object({ feature_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.feature_id, input.key, input.value);
      return { success: true };
    }),
});
