import { z } from "zod";
import fs from "node:fs";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import { projectsRouter } from "./projects";
import { featuresRouter } from "./features";
import { discoverClaudeCli } from "../agents/cli-discovery";
import {
  startSubprocess,
  killSubprocess,
  listSubprocesses,
} from "../agents/subprocess-manager";
import { bridgeSubprocessToRenderer } from "../agents/ipc-bridge";
import type { AgentType } from "../agents/types";

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

const agentTypeSchema = z.enum(["plan", "brainstorm", "execute", "risk", "review"]);

const agentsRouter = router({
  /** Start a new agent subprocess */
  start: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        agentType: agentTypeSchema,
        systemPrompt: z.string().optional(),
        prompt: z.string(),
        resumeSessionId: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const managed = startSubprocess({
        cwd: input.cwd,
        agentType: input.agentType,
        systemPrompt: input.systemPrompt,
        prompt: input.prompt,
        resumeSessionId: input.resumeSessionId,
        allowedTools: input.allowedTools,
      });

      // Bridge the subprocess stdout to renderer windows
      bridgeSubprocessToRenderer(managed, input.agentType as AgentType);

      return {
        id: managed.id,
        agentType: managed.agentType,
        status: managed.status,
      };
    }),

  /** Stop a running agent subprocess */
  stop: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const killed = killSubprocess(input.id);
      return { success: killed };
    }),

  /** Resume a previous agent session */
  resume: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        agentType: agentTypeSchema,
        sessionId: z.string(),
        allowedTools: z.array(z.string()).optional(),
      }),
    )
    .mutation(({ input }) => {
      const managed = startSubprocess({
        cwd: input.cwd,
        agentType: input.agentType,
        prompt: "",
        resumeSessionId: input.sessionId,
        allowedTools: input.allowedTools,
      });

      bridgeSubprocessToRenderer(managed, input.agentType as AgentType);

      return {
        id: managed.id,
        agentType: managed.agentType,
        status: managed.status,
      };
    }),

  /** List all active agent subprocesses */
  list: publicProcedure.query(() => {
    return listSubprocesses().map((s) => ({
      id: s.id,
      agentType: s.agentType,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
    }));
  }),
});

export const appRouter = router({
  hello: publicProcedure.input(z.object({ name: z.string().optional() })).query(({ input }) => {
    return { greeting: `Hello, ${input.name ?? "world"}!` };
  }),
  settings: settingsRouter,
  projects: projectsRouter,
  features: featuresRouter,
  agents: agentsRouter,
});

export type AppRouter = typeof appRouter;
