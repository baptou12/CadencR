import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import { projectsRouter } from "./projects";
import { featuresRouter } from "./features";

const settingsRouter = router({
  get: publicProcedure
    .input(z.object({ key: z.string() }))
    .query(({ input }) => {
      const db = getDatabase();
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(input.key) as { value: string } | undefined;
      return row?.value ?? null;
    }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(input.key, input.value);
      return { success: true };
    }),

  list: publicProcedure.query(() => {
    const db = getDatabase();
    const rows = db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    return rows;
  }),
});

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string().optional() }))
    .query(({ input }) => {
      return { greeting: `Hello, ${input.name ?? "world"}!` };
    }),
  settings: settingsRouter,
  projects: projectsRouter,
  features: featuresRouter,
});

export type AppRouter = typeof appRouter;
