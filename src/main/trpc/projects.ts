import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";

export const projectsRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT id, name, path, created_at FROM projects ORDER BY created_at DESC")
      .all() as { id: number; name: string; path: string; created_at: string }[];
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

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("DELETE FROM projects WHERE id = ?").run(input.id);
      return { success: true };
    }),
});
