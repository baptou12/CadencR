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
  sendSubprocessInput,
} from "../agents/subprocess-manager";
import { bridgeSubprocessToRenderer } from "../agents/ipc-bridge";
import type { AgentType } from "../agents/types";
import {
  createWorktree,
  removeWorktree,
  getWorktreeInfo,
  openInTerminal,
  buildBranchName,
} from "../git/worktree";
import { startPlanAgent } from "../agents/plan-agent";

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

  /** Send input to a running agent subprocess via stdin */
  sendInput: publicProcedure
    .input(z.object({ id: z.string(), text: z.string() }))
    .mutation(({ input }) => {
      const sent = sendSubprocessInput(input.id, input.text);
      return { success: sent };
    }),

  /** Start the plan agent for a feature */
  startPlan: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        description: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();

      // Determine working directory: use worktree path if available, else project path
      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as { value: string } | undefined;

      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as { path: string } | undefined;

      const cwd = wtRow?.value ?? project?.path;
      if (!cwd) throw new Error("No working directory found for this feature");

      const result = startPlanAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        description: input.description,
        cwd,
      });

      return result;
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

const gitRouter = router({
  /** Create a git worktree for a feature */
  createWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
        featureTitle: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT id, name, path FROM projects WHERE id = ?")
        .get(input.projectId) as { id: number; name: string; path: string } | undefined;
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      // Get branch prefix from project settings (default: "feature/")
      const prefixRow = db
        .prepare(
          "SELECT value FROM project_settings WHERE project_id = ? AND key = 'branch_prefix'",
        )
        .get(input.projectId) as { value: string } | undefined;
      const prefix = prefixRow?.value ?? "feature/";

      const branchName = buildBranchName(prefix, input.featureTitle);
      const result = createWorktree(project.path, branchName, project.name);

      // Store worktree path in feature settings
      db.prepare(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.featureId, "worktree_path", result.worktreePath);
      db.prepare(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.featureId, "worktree_branch", result.branch);

      return result;
    }),

  /** Remove a git worktree */
  removeWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as { path: string } | undefined;
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as { value: string } | undefined;
      if (!wtRow) throw new Error("No worktree found for this feature");

      removeWorktree(project.path, wtRow.value);

      // Clean up feature settings
      db.prepare(
        "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
      ).run(input.featureId);

      return { success: true };
    }),

  /** Get worktree info for a feature */
  getWorktreeInfo: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as { path: string } | undefined;
      if (!project) return null;

      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as { value: string } | undefined;
      if (!wtRow) return null;

      return getWorktreeInfo(project.path, wtRow.value);
    }),

  /** Open a worktree path in the system terminal */
  openInTerminal: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as { value: string } | undefined;
      if (!wtRow) throw new Error("No worktree found for this feature");

      openInTerminal(wtRow.value);
      return { success: true };
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
  git: gitRouter,
});

export type AppRouter = typeof appRouter;
