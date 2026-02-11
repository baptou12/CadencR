import { z } from "zod";
import fs from "node:fs";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { SettingRow, ProjectRow, AgentMessageRow, AgentSessionRow } from "../db/types";
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
  getGitStats,
} from "../git/worktree";
import { startPlanAgent } from "../agents/plan-agent";
import { startBrainstormAgent } from "../agents/brainstorm-agent";
import { startExecuteAgent } from "../agents/execute-agent";
import { startRiskAgent } from "../agents/risk-agent";
import { startReviewAgent, addFixPhase } from "../agents/review-agent";

const settingsRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(input.key) as
      | SettingRow
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
    const rows = db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
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
        .get(input.featureId) as SettingRow | undefined;

      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;

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

  /** Start the brainstorm agent for a feature */
  startBrainstorm: publicProcedure
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
        .get(input.featureId) as SettingRow | undefined;

      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;

      const cwd = wtRow?.value ?? project?.path;
      if (!cwd) throw new Error("No working directory found for this feature");

      const result = startBrainstormAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        description: input.description,
        cwd,
      });

      return result;
    }),

  /** Start the execute agent for a feature (runs plan phases) */
  startExecute: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();

      // Determine working directory
      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;

      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;

      const cwd = wtRow?.value ?? project?.path;
      if (!cwd) throw new Error("No working directory found for this feature");

      const result = startExecuteAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        cwd,
      });

      return result;
    }),

  /** Start the risk analysis agent for a feature */
  startRisk: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();

      // Determine working directory
      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;

      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;

      const cwd = wtRow?.value ?? project?.path;
      if (!cwd) throw new Error("No working directory found for this feature");

      const result = startRiskAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        cwd,
      });

      return result;
    }),

  /** Start the review agent for a feature */
  startReview: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();

      // Determine working directory
      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;

      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;

      const cwd = wtRow?.value ?? project?.path;
      if (!cwd) throw new Error("No working directory found for this feature");

      const result = startReviewAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        cwd,
      });

      return result;
    }),

  /** Add a fix phase to the plan based on review findings */
  addFixPhase: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        fixDescription: z.string(),
      }),
    )
    .mutation(({ input }) => {
      return addFixPhase(input.featureId, input.fixDescription);
    }),

  /** Get message history for an agent session */
  getHistory: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const messages = db
        .prepare(
          "SELECT id, session_id, role, content, message_type, tool_name, created_at FROM agent_messages WHERE session_id = ? ORDER BY id ASC",
        )
        .all(input.sessionId) as AgentMessageRow[];
      return messages;
    }),

  /** Get sessions for a feature (optionally filter by status) */
  getSessions: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        status: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase();
      let query =
        "SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at FROM agent_sessions WHERE feature_id = ?";
      const params: (number | string)[] = [input.featureId];
      if (input.status) {
        query += " AND status = ?";
        params.push(input.status);
      }
      query += " ORDER BY id DESC";
      const sessions = db.prepare(query).all(...params) as AgentSessionRow[];
      return sessions;
    }),

  /** Get incomplete sessions that can be resumed */
  getIncompleteSessions: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const sessions = db
        .prepare(
          "SELECT id, feature_id, agent_type, claude_session_id, status, started_at FROM agent_sessions WHERE feature_id = ? AND status = 'running' AND claude_session_id IS NOT NULL ORDER BY id DESC",
        )
        .all(input.featureId) as AgentSessionRow[];
      return sessions;
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

  /** Get feature IDs that have running agent sessions */
  getActiveFeatureIds: publicProcedure.query(() => {
    const db = getDatabase();
    const rows = db
      .prepare(
        "SELECT DISTINCT feature_id FROM agent_sessions WHERE status = 'running'",
      )
      .all() as Array<{ feature_id: number }>;
    return rows.map((r) => r.feature_id);
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
        .get(input.projectId) as ProjectRow | undefined;
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      // Get branch prefix from project settings (default: "feature/")
      const prefixRow = db
        .prepare(
          "SELECT value FROM project_settings WHERE project_id = ? AND key = 'branch_prefix'",
        )
        .get(input.projectId) as SettingRow | undefined;
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
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;
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
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project) return null;

      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow) return null;

      return getWorktreeInfo(project.path, wtRow.value);
    }),

  /** Get git diff stats (LOC changed) for a feature's worktree */
  getStats: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow) return { filesChanged: 0, insertions: 0, deletions: 0 };
      return getGitStats(wtRow.value);
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
        .get(input.featureId) as SettingRow | undefined;
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
