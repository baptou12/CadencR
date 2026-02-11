import { z } from "zod";
import fs from "node:fs";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import { projectsRouter } from "./projects";
import { featuresRouter } from "./features";
import { discoverClaudeCli } from "../agents/cli-discovery";

const settingsRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(input.key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
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

  /** Get the current Claude CLI path (from settings or auto-discovered) */
  getClaudeCliPath: publicProcedure.query(() => {
    const cliInfo = discoverClaudeCli();
    return cliInfo ? { path: cliInfo.path, source: cliInfo.source } : null;
  }),

  /** Set a custom Claude CLI path (validates the file exists) */
  setClaudeCliPath: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(({ input }) => {
      if (!fs.existsSync(input.path)) {
        throw new Error(`File not found: ${input.path}`);
      }
      const db = getDatabase();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run("claude_cli_path", input.path);
      return { success: true, path: input.path };
    }),
});

export const appRouter = router({
  hello: publicProcedure.input(z.object({ name: z.string().optional() })).query(({ input }) => {
    return { greeting: `Hello, ${input.name ?? "world"}!` };
  }),
  settings: settingsRouter,
  projects: projectsRouter,
  features: featuresRouter,
});

export type AppRouter = typeof appRouter;
