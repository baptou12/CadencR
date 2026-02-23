import { z } from "zod";
import fs from "node:fs";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { SettingRow, ProjectRow, AgentMessageRow, AgentSessionRow } from "../db/types";
import { projectsRouter } from "./projects";
import { featuresRouter } from "./features";
import { discoverClaudeCli } from "../agents/cli-discovery";
import { DEFAULT_MODEL } from "../agents/models";
import {
  startSubprocess,
  stopSubprocess,
  interruptSubprocess,
  listSubprocesses,
  submitUserAnswers,
  submitPlanApproval,
  submitToolPermission,
  sendMessageToSubprocess,
  setSubprocessPermissionMode,
  getSupportedCommands,
} from "../agents/subprocess-manager";
import { getBackgroundTasks } from "../agents/background-tasks";
import { getSubprocessIdForSession, notifyDbUpdated } from "../agents/session-persistence";
import type { AgentType } from "../agents/types";
import { execSync } from "node:child_process";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  getWorktreeInfo,
  openInTerminal,
  buildBranchName,
  getGitStats,
  getDiff,
  getChangedFiles,
  getCurrentBranch,
  setupWorktreeForFeature,
  getOriginalBranch,
  checkMergeConflicts,
  mergeBranch,
  deleteLocalBranch,
  hasUncommittedChanges,
} from "../git/worktree";
import { diffCommentsRouter } from "./diff-comments";
import { diffViewedRouter } from "./diff-viewed";
import { usageRouter } from "./usage";
import { terminalRouter } from "./terminal";
import { startUnifiedAgent } from "../agents/unified-agent";
import {
  startPlanAgent,
  startBrainstormAgent,
  startRefinePlanAgent,
  startRefineBrainstormAgent,
  startRiskAgent,
  startReviewAgent,
  addFixPhase,
  startSessionAgent,
  startQaAgent,
  startReviewFixerAgent,
} from "../agents/agent-starters";
import { startExecuteAgent, continueExecuteAgent, buildPhaseCompletionAction } from "../agents/execute-agent";
import { transitionAgentSession } from "../agents/state-transitions";
import { autoNameFeature, runAutoNameBlocking } from "../agents/auto-name";
import { fetchAvailableModels } from "../agents/available-models";

/**
 * Resolve the git directory for a feature.
 * Session features always use the project path (they work on main).
 * Workflow features use their worktree path if available.
 */
function resolveFeatureGitPath(featureId: number): string | null {
  const db = getDatabase();
  const feature = db
    .prepare("SELECT project_id, type FROM features WHERE id = ?")
    .get(featureId) as { project_id: number; type: string } | undefined;
  if (!feature) return null;

  // Session features always use the project path directly
  if (feature.type !== "session") {
    const wtRow = db
      .prepare(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
      )
      .get(featureId) as SettingRow | undefined;
    if (wtRow) return wtRow.value;
  }

  const project = db
    .prepare("SELECT path FROM projects WHERE id = ?")
    .get(feature.project_id) as Pick<ProjectRow, "path"> | undefined;
  return project?.path ?? null;
}

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

  /** Get model settings for all agent types from global settings */
  getModelSettings: publicProcedure.query(() => {
    const db = getDatabase();
    const agentTypes = ["plan", "brainstorm", "execute", "risk", "review", "session", "qa"] as const;
    const result: Record<string, string> = {};
    for (const at of agentTypes) {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(`model_${at}`) as SettingRow | undefined;
      result[at] = row?.value ?? DEFAULT_MODEL;
    }
    return result as Record<AgentType, string>;
  }),

  /** Set a model for a specific agent type in global settings */
  setModelSetting: publicProcedure
    .input(
      z.object({
        agentType: z.enum(["plan", "brainstorm", "execute", "risk", "review", "session", "qa", "review-fixer"]),
        modelId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const key = `model_${input.agentType}`;
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, input.modelId);
      return { success: true };
    }),

  /** Get available models from Claude CLI (cached after first call) */
  getAvailableModels: publicProcedure.query(async () => {
    return await fetchAvailableModels();
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

/** Resolve the working directory for an agent, preferring worktree path over project path. */
function resolveAgentCwd(featureId: number, projectId: number): { cwd: string; worktreePath?: string } {
  const db = getDatabase();

  const wtRow = db
    .prepare(
      "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
    )
    .get(featureId) as SettingRow | undefined;

  const project = db
    .prepare("SELECT path FROM projects WHERE id = ?")
    .get(projectId) as Pick<ProjectRow, "path"> | undefined;

  if (!wtRow) {
    // Check if there was a worktree creation error
    const errorRow = db
      .prepare(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_error'",
      )
      .get(featureId) as SettingRow | undefined;

    if (errorRow) {
      console.warn(
        `Worktree not available for feature ${featureId}, falling back to project path. Worktree error: ${errorRow.value}`,
      );
    }
  }

  const cwd = wtRow?.value ?? project?.path;
  if (!cwd) throw new Error("No working directory found for this feature");
  if (!fs.existsSync(cwd)) {
    throw new Error(
      `Agent working directory does not exist: ${cwd}. The worktree may not have been created yet or was removed.`,
    );
  }
  return { cwd, worktreePath: wtRow?.value };
}

/** Check if a feature still has its default auto-generated title (e.g. "Session 3") */
function hasDefaultTitle(featureId: number): boolean {
  const db = getDatabase();
  const row = db.prepare("SELECT title FROM features WHERE id = ?").get(featureId) as { title: string } | undefined;
  return row != null && /^Session \d+$/i.test(row.title);
}

const agentTypeSchema = z.enum(["plan", "brainstorm", "execute", "risk", "review", "session", "qa", "review-fixer"]);

// ---------------------------------------------------------------------------
// Block builder — converts agent_messages rows into a nested block tree
// ---------------------------------------------------------------------------

interface AgentBlock {
  id: string;
  type: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  toolUseId?: string;
  parentToolUseId?: string | null;
  childBlocks?: AgentBlock[];
  sourceToolName?: string;
  createdAt?: string;
  model?: string;
}

function appendText(list: AgentBlock[], msgId: number, content: string, parentId?: string | null, createdAt?: string, model?: string | null) {
  const last = list.length > 0 ? list[list.length - 1] : null;
  if (last && last.type === "text" && !last.parentToolUseId === !parentId) {
    last.content += content;
    // Keep the first message's id and createdAt for the merged block
  } else {
    list.push({ id: `msg-${msgId}`, type: "text", content, parentToolUseId: parentId, createdAt, model: model ?? undefined });
  }
}

function buildBlocks(messages: AgentMessageRow[]): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  const byToolUseId = new Map<string, AgentBlock>();

  function targetList(parentId: string | null | undefined): AgentBlock[] {
    if (parentId) {
      const parent = byToolUseId.get(parentId);
      if (parent?.childBlocks) return parent.childBlocks;
    }
    return blocks;
  }

  for (const msg of messages) {
    const list = targetList(msg.parent_tool_use_id);
    const id = `msg-${msg.id}`;

    switch (msg.message_type) {
      case "text":
      case "text_delta":
        appendText(list, msg.id, msg.content, msg.parent_tool_use_id, msg.created_at, msg.model);
        break;
      case "tool_call": {
        // Deduplicate: if we already have a block with this tool_use_id,
        // update its content instead of creating a duplicate (the SDK sends
        // the same tool_call via both stream_event and assistant messages).
        if (msg.tool_use_id && byToolUseId.has(msg.tool_use_id)) {
          const existing = byToolUseId.get(msg.tool_use_id)!;
          if (msg.content && (!existing.content || existing.content.length < msg.content.length)) {
            existing.content = msg.content;
            existing.toolArgs = msg.content;
          }
          break;
        }
        const isTask = msg.tool_name === "Task";
        const block: AgentBlock = {
          id,
          type: "tool_call",
          content: msg.content,
          toolName: msg.tool_name ?? "tool",
          toolArgs: msg.content,
          toolUseId: msg.tool_use_id ?? undefined,
          parentToolUseId: msg.parent_tool_use_id,
          childBlocks: isTask ? [] : undefined,
          createdAt: msg.created_at,
        };
        if (msg.tool_use_id) byToolUseId.set(msg.tool_use_id, block);
        list.push(block);
        break;
      }
      case "tool_result":
      case "tool_error": {
        // Resolve the source tool name from the parent tool_call
        let sourceToolName: string | undefined;
        if (msg.tool_use_id && byToolUseId.has(msg.tool_use_id)) {
          sourceToolName = byToolUseId.get(msg.tool_use_id)!.toolName;
        } else {
          // Fallback for historical data where tool_use_id is null on tool_result rows:
          // scan backwards for the last tool_call in this list
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].type === "tool_call") {
              sourceToolName = list[i].toolName;
              break;
            }
          }
        }
        list.push({
          id,
          type: "tool_result",
          content: msg.content,
          isError: msg.message_type === "tool_error",
          parentToolUseId: msg.parent_tool_use_id,
          sourceToolName,
          createdAt: msg.created_at,
        });
        break;
      }
      case "user_message":
        list.push({ id, type: "user_message", content: msg.content, parentToolUseId: msg.parent_tool_use_id, createdAt: msg.created_at });
        break;
      case "error":
        list.push({ id, type: "text", content: `Error: ${msg.content}`, parentToolUseId: msg.parent_tool_use_id });
        break;
      case "compact_divider":
        list.push({ id, type: "compact_divider", content: "", parentToolUseId: msg.parent_tool_use_id });
        break;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------

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

      return {
        id: managed.id,
        agentType: managed.agentType,
        status: managed.status,
      };
    }),

  /** Stop a running agent subprocess */
  stop: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const stopped = await stopSubprocess(input.id);
      return { success: stopped };
    }),

  /** Interrupt all running agent subprocesses (pauses them for resume) */
  stopAll: publicProcedure.mutation(async () => {
    const running = listSubprocesses().filter((s) => s.status === "running");
    let stopped = 0;
    for (const s of running) {
      if (await interruptSubprocess(s.id)) stopped++;
    }
    return { stopped };
  }),

  /** Interrupt a running agent — pauses without killing, allows resume via sendMessage */
  interrupt: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const interrupted = await interruptSubprocess(input.id);
      return { success: interrupted };
    }),


  /** Resume a previous agent session (reuses the same DB row) */
  resume: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        agentType: agentTypeSchema,
        sessionId: z.string(),
        originalSessionDbId: z.number(),
        prompt: z.string().optional(),
        images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();

      // Resolve CWD to match the original session start path.
      // Standalone session features use the project path; workflow session
      // agents (within a feature) use the worktree — we must match this on
      // resume or Claude CLI can't find the session file.
      let cwd: string;
      let worktreePath: string | undefined;
      if (input.agentType === "session") {
        const feature = db
          .prepare("SELECT type FROM features WHERE id = ?")
          .get(input.featureId) as { type: string } | undefined;
        if (feature?.type === "feature") {
          // Workflow session — was started with worktree CWD
          ({ cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId));
        } else {
          // Standalone session — was started with project path CWD
          const project = db
            .prepare("SELECT path FROM projects WHERE id = ?")
            .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
          if (!project?.path) throw new Error("Project path not found");
          cwd = project.path;
        }
      } else {
        ({ cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId));
      }

      const originalSession = db
        .prepare("SELECT run_id, phase_id FROM agent_sessions WHERE id = ?")
        .get(input.originalSessionDbId) as Pick<AgentSessionRow, "run_id" | "phase_id"> | undefined;

      // Clear any pending questions — the user's answer is now the resume prompt
      db.prepare("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?")
        .run(input.originalSessionDbId);

      // When resuming an execute session tied to a phase, wire up the phase
      // completion action so the phase status is synced when the agent finishes.
      const completionActions = originalSession?.phase_id
        ? [buildPhaseCompletionAction(originalSession.phase_id, input.featureId)]
        : undefined;

      let resumePrompt: import("../agents/types").MessageContent;
      const promptText = input.prompt ?? "Continue from where you left off.";
      if (input.images && input.images.length > 0) {
        resumePrompt = [
          { type: "text" as const, text: promptText },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        resumePrompt = promptText;
      }

      const result = startUnifiedAgent({
        agentType: input.agentType as AgentType,
        featureId: input.featureId,
        projectId: input.projectId,
        cwd,
        prompt: resumePrompt,
        resumeSessionId: input.sessionId,
        runId: originalSession?.run_id ?? undefined,
        phaseId: originalSession?.phase_id ?? undefined,
        existingSessionDbId: input.originalSessionDbId,
        completionActions,
        worktreePath,
      });

      return { subprocessId: result.subprocessId, agentType: result.agentType, sessionDbId: result.sessionDbId };
    }),

  /** Submit user answers for an AskUserQuestion tool call */
  submitAnswers: publicProcedure
    .input(
      z.object({
        subprocessId: z.string(),
        answers: z.record(z.string(), z.string()),
      }),
    )
    .mutation(({ input }) => {
      submitUserAnswers(input.subprocessId, input.answers);
      return { success: true };
    }),

  /** Submit plan approval or rejection for a pending ExitPlanMode tool call */
  submitPlanApproval: publicProcedure
    .input(
      z.object({
        subprocessId: z.string(),
        approved: z.boolean(),
        feedback: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      return submitPlanApproval(input.subprocessId, input.approved, input.feedback);
    }),

  /** Clear a stale pending_plan_approval (e.g. when subprocess is gone after restart) */
  clearPlanApproval: publicProcedure
    .input(z.object({ sessionDbId: z.number() }))
    .mutation(({ input }) => {
      try {
        const db = getDatabase();
        db.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(input.sessionDbId);
        const row = db.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(input.sessionDbId) as { feature_id: number } | undefined;
        if (row) notifyDbUpdated("agent_session", row.feature_id);
        return { success: true };
      } catch {
        return { success: false };
      }
    }),

  /** Submit a tool permission decision from the renderer */
  submitToolPermission: publicProcedure
    .input(
      z.object({
        subprocessId: z.string(),
        decision: z.enum(["allow_once", "allow_future", "deny"]),
        feedback: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      submitToolPermission(input.subprocessId, input.decision, input.feedback);
      return { success: true };
    }),

  /** Send a message to a running agent subprocess */
  sendMessage: publicProcedure
    .input(z.object({
      id: z.string(),
      message: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(async ({ input }) => {
      let content: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        content = [
          { type: "text" as const, text: input.message },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        content = input.message;
      }
      return sendMessageToSubprocess(input.id, content);
    }),

  /** Start the plan agent for a feature */
  startPlan: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      let description: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        description = [
          { type: "text" as const, text: input.description },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        description = input.description;
      }
      return startPlanAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Start the brainstorm agent for a feature */
  startBrainstorm: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      let description: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        description = [
          { type: "text" as const, text: input.description },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        description = input.description;
      }
      return startBrainstormAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Refine an existing plan — start a plan agent that appends new phases */
  startRefinePlan: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      let description: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        description = [
          { type: "text" as const, text: input.description },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        description = input.description;
      }
      return startRefinePlanAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Refine an existing plan — start a brainstorm agent that appends new phases */
  startRefineBrainstorm: publicProcedure
    .input(z.object({
      featureId: z.number(),
      projectId: z.number(),
      description: z.string(),
      images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
    }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      let description: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        description = [
          { type: "text" as const, text: input.description },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        description = input.description;
      }
      return startRefineBrainstormAgent({ featureId: input.featureId, projectId: input.projectId, description, cwd, worktreePath });
    }),

  /** Start the execute agent for a feature (runs plan phases) */
  startExecute: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      return startExecuteAgent({ ...input, cwd, worktreePath });
    }),

  /** Continue a waiting execute orchestrator (Level 2 autonomy) */
  continueExecute: publicProcedure
    .input(z.object({ sessionDbId: z.number() }))
    .mutation(({ input }) => continueExecuteAgent(input.sessionDbId)),

  /** Start the risk analysis agent for a feature */
  startRisk: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      return startRiskAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the review agent for a feature */
  startReview: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      return startReviewAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the QA agent for a feature */
  startQa: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number() }))
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      return startQaAgent({ ...input, cwd, worktreePath });
    }),

  /** Start the review-fixer agent to address diff comments */
  startReviewFixer: publicProcedure
    .input(z.object({ featureId: z.number(), projectId: z.number(), prompt: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);

      // Build rich prompt with feature context (same as workflow session)
      const feature = db.prepare("SELECT title FROM features WHERE id = ?").get(input.featureId) as { title: string } | undefined;
      const plan = db.prepare("SELECT id, summary, context FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1").get(input.featureId) as { id: number; summary: string | null; context: string | null } | undefined;
      const phases = plan
        ? (db.prepare("SELECT title, status, step_number FROM phases WHERE plan_id = ? ORDER BY step_number, order_index").all(plan.id) as { title: string; status: string; step_number: number }[])
        : [];

      const parts: string[] = [];
      if (feature) parts.push(`## Feature: ${feature.title}`);
      if (plan?.summary) parts.push(`**Summary:** ${plan.summary}`);
      if (plan?.context) parts.push(`**Context:** ${plan.context}`);
      if (phases.length > 0) {
        const phaseList = phases.map((p) => `${p.step_number}. ${p.title} — ${p.status}`).join("\n");
        parts.push(`**Phases:**\n${phaseList}`);
      }
      parts.push("---", `## Diff Comments to Address\n\n${input.prompt}`);

      const prompt = parts.join("\n\n");
      return startReviewFixerAgent({ ...input, prompt, cwd, worktreePath });
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

  /** Start a session agent within a feature workflow (uses worktree).
   *  Starts immediately with a placeholder prompt — the user's first
   *  message in the prompt bar becomes the real task. */
  startWorkflowSession: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        prompt: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const { cwd, worktreePath } = resolveAgentCwd(input.featureId, input.projectId);
      const db = getDatabase();

      const feature = db.prepare("SELECT title FROM features WHERE id = ?").get(input.featureId) as { title: string } | undefined;
      if (!feature) throw new Error("Feature not found");
      const plan = db.prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY id DESC LIMIT 1").get(input.featureId) as { id: number } | undefined;
      if (!plan) throw new Error("No plan found for this feature — workflow sessions require a plan");

      const prompt = `Context: you're building "${feature.title}" (plan ID: ${plan.id})\n\n${input.prompt}`;

      const result = startSessionAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        prompt,
        cwd,
        worktreePath,
        planId: plan.id,
      });

      return result;
    }),

  /** Start a free-form session agent on a project */
  startSession: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        prompt: z.string(),
        images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
        permissionMode: z.enum(["acceptEdits", "plan"]).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project path not found");

      let prompt: import("../agents/types").MessageContent;
      if (input.images && input.images.length > 0) {
        prompt = [
          { type: "text" as const, text: input.prompt },
          ...input.images.map((img) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: img.mimeType, data: img.base64 },
          })),
        ];
      } else {
        prompt = input.prompt;
      }

      const result = startSessionAgent({
        featureId: input.featureId,
        projectId: input.projectId,
        prompt,
        cwd: project.path,
        permissionMode: input.permissionMode,
      });

      if (hasDefaultTitle(input.featureId)) {
        autoNameFeature(input.featureId, input.prompt, project.path, input.projectId);
      }

      return result;
    }),

  /** Ensure a worktree exists for a feature, blocking until created.
   *  Auto-names the feature first if it has a default title.
   *  Returns the worktree path as `cwd`.
   *  Setup commands are fired off in the background (non-blocking). */
  ensureWorktree: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        projectId: z.number(),
        description: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project path not found");

      // Step 1: Auto-name if feature has a default title
      const feature = db
        .prepare("SELECT title FROM features WHERE id = ?")
        .get(input.featureId) as { title: string } | undefined;
      if (!feature) throw new Error(`Feature not found: ${input.featureId}`);

      if (/^(Untitled Feature|Session \d+)$/i.test(feature.title)) {
        await runAutoNameBlocking(input.featureId, input.description, project.path);
      }

      // Step 2: Create worktree (blocking) — returns after worktree exists on disk
      const worktreePath = await setupWorktreeForFeature(
        input.projectId,
        input.featureId,
        { skipSetupCommands: true },
      );

      // Step 3: Fire off setup commands in background (non-blocking)
      setupWorktreeForFeature(input.projectId, input.featureId, {
        onlySetupCommands: true,
      }).catch((err) => {
        console.error("[ensureWorktree] Setup commands failed:", err);
      });

      // worktreePath is the returned path from skipSetupCommands mode
      const cwd = worktreePath ?? project.path;
      return { cwd };
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
        "SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at, run_id, phase_id, model FROM agent_sessions WHERE feature_id = ?";
      const params: (number | string)[] = [input.featureId];
      if (input.status) {
        query += " AND status = ?";
        params.push(input.status);
      }
      query += " ORDER BY id DESC";
      const sessions = db.prepare(query).all(...params) as AgentSessionRow[];
      return sessions;
    }),

  /** Stop a running agent by its DB session ID (used when subprocess ID is unknown after refresh) */
  stopBySessionId: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const session = db
        .prepare("SELECT subprocess_id, status FROM agent_sessions WHERE id = ?")
        .get(input.sessionId) as Pick<AgentSessionRow, "subprocess_id" | "status"> | undefined;
      if (!session) return { success: false };

      // Try to stop the subprocess if it's still alive
      if (session.subprocess_id) {
        const stopped = await stopSubprocess(session.subprocess_id);
        if (stopped) return { success: true };
      }

      // Subprocess already gone — update DB directly if still marked as running/paused
      if (session.status === "running" || session.status === "paused") {
        transitionAgentSession(db, input.sessionId, "completed", undefined, { ended_at: "datetime('now')", subprocess_id: null });
      }
      return { success: true };
    }),

  /** Interrupt a running agent by its DB session ID */
  interruptBySessionId: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const session = db
        .prepare("SELECT subprocess_id FROM agent_sessions WHERE id = ?")
        .get(input.sessionId) as Pick<AgentSessionRow, "subprocess_id"> | undefined;
      if (!session?.subprocess_id) return { success: false };
      const interrupted = await interruptSubprocess(session.subprocess_id);
      return { success: interrupted };
    }),

  /** Delete an agent session and its messages (only non-running, non-completed) */
  deleteSession: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const session = db
        .prepare("SELECT id, status FROM agent_sessions WHERE id = ?")
        .get(input.sessionId) as Pick<AgentSessionRow, "id" | "status"> | undefined;
      if (!session) throw new Error("Session not found");
      if (session.status === "completed" || session.status === "running") {
        throw new Error("Cannot delete a completed or running session");
      }
      db.prepare("DELETE FROM agent_messages WHERE session_id = ?").run(input.sessionId);
      db.prepare("DELETE FROM agent_sessions WHERE id = ?").run(input.sessionId);
      return { success: true };
    }),

  /** Change the permission mode of a running session agent */
  setPermissionMode: publicProcedure
    .input(
      z.object({
        sessionId: z.number(),
        mode: z.enum(["acceptEdits", "plan"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase();
      // Update DB regardless of whether subprocess is active
      db.prepare("UPDATE agent_sessions SET permission_mode = ? WHERE id = ?")
        .run(input.mode, input.sessionId);
      // If subprocess is running, update it at runtime
      const session = db
        .prepare("SELECT subprocess_id FROM agent_sessions WHERE id = ?")
        .get(input.sessionId) as Pick<AgentSessionRow, "subprocess_id"> | undefined;
      if (session?.subprocess_id) {
        await setSubprocessPermissionMode(session.subprocess_id, input.mode);
      }
      return { success: true };
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

  /** Get the active subprocess ID for a feature's session (if still alive) */
  getActiveSessionProcess: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      // Find the latest running session for this feature
      const session = db
        .prepare(
          "SELECT id FROM agent_sessions WHERE feature_id = ? AND agent_type = 'session' AND status = 'running' ORDER BY id DESC LIMIT 1",
        )
        .get(input.featureId) as { id: number } | undefined;
      if (!session) return null;
      const subprocessId = getSubprocessIdForSession(session.id);
      if (!subprocessId) return null;
      // Verify it's actually still active
      const active = listSubprocesses().find((s) => s.id === subprocessId);
      if (!active || active.status === "completed" || active.status === "error" || active.status === "stopped") return null;
      return { subprocessId, sessionDbId: session.id, status: active.status };
    }),

  /** Get all agent state for a feature in a single query */
  getFeatureAgentState: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const sessions = db
        .prepare(
          "SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at, run_id, phase_id, subprocess_id, model, pending_questions, has_file_changes, permission_mode, pending_plan_approval, pending_permission, input_tokens, output_tokens, context_window, was_compacted, draft_prompt FROM agent_sessions WHERE feature_id = ? ORDER BY id ASC",
        )
        .all(input.featureId) as (AgentSessionRow & { draft_prompt: string | null })[];

      if (sessions.length === 0) return { sessions: [] };

      // Batch-fetch phase titles for execute sessions
      const phaseIds = sessions.map((s) => s.phase_id).filter((id): id is number => id != null);
      const phaseTitleMap = new Map<number, string>();
      if (phaseIds.length > 0) {
        const phPlaceholders = phaseIds.map(() => "?").join(",");
        const phases = db
          .prepare(`SELECT id, title FROM phases WHERE id IN (${phPlaceholders})`)
          .all(...phaseIds) as Array<{ id: number; title: string }>;
        for (const p of phases) {
          phaseTitleMap.set(p.id, p.title);
        }
      }

      // Batch-fetch all messages for these sessions
      const sessionIds = sessions.map((s) => s.id);
      const placeholders = sessionIds.map(() => "?").join(",");
      const allMessages = db
        .prepare(
          `SELECT id, session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id IN (${placeholders}) ORDER BY id ASC`,
        )
        .all(...sessionIds) as AgentMessageRow[];

      // Group messages by session
      const messagesBySession = new Map<number, AgentMessageRow[]>();
      for (const msg of allMessages) {
        let arr = messagesBySession.get(msg.session_id);
        if (!arr) {
          arr = [];
          messagesBySession.set(msg.session_id, arr);
        }
        arr.push(msg);
      }

      return {
        sessions: sessions.map((s) => {
          let pendingQuestions: unknown = null;
          if (s.pending_questions) {
            try { pendingQuestions = JSON.parse(s.pending_questions); } catch { /* ignore */ }
          }
          const msgs = messagesBySession.get(s.id) ?? [];
          const maxMessageId = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;

          // Extract the last TodoWrite tool call to get current todo list
          let todos: Array<{ content: string; status: string; activeForm: string }> | null = null;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i];
            if (msg.message_type === "tool_call" && msg.tool_name === "TodoWrite") {
              try {
                const parsed = JSON.parse(msg.content);
                if (parsed.todos && Array.isArray(parsed.todos)) {
                  todos = parsed.todos;
                }
              } catch { /* ignore parse errors */ }
              break;
            }
          }

          return {
            sessionDbId: s.id,
            agentType: s.agent_type as AgentType,
            status: s.status,
            subprocessId: s.subprocess_id,
            model: s.model,
            blocks: buildBlocks(msgs),
            maxMessageId,
            pendingQuestions,
            hasFileChanges: s.has_file_changes === 1,
            resumable: (s.status === "paused" || s.status === "completed" || s.status === "error") && s.claude_session_id != null,
            claudeSessionId: s.claude_session_id,
            runId: s.run_id,
            phaseId: s.phase_id,
            phaseTitle: s.phase_id != null ? phaseTitleMap.get(s.phase_id) ?? null : null,
            todos,
            permissionMode: s.permission_mode ?? "acceptEdits",
            pendingPlanApproval: s.pending_plan_approval ? (() => { try { return JSON.parse(s.pending_plan_approval); } catch { return null; } })() : null,
            pendingPermission: s.pending_permission ? (() => { try { return JSON.parse(s.pending_permission); } catch { return null; } })() : null,
            inputTokens: s.input_tokens ?? 0,
            outputTokens: s.output_tokens ?? 0,
            contextWindow: s.context_window ?? 200000,
            wasCompacted: s.was_compacted === 1,
            draftPrompt: s.draft_prompt ?? null,
          };
        }),
      };
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

  /** Get turn states for features with running sessions */
  getFeatureTurnStates: publicProcedure.query(() => {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT feature_id,
          MAX(CASE WHEN pending_questions IS NOT NULL OR pending_permission IS NOT NULL OR pending_plan_approval IS NOT NULL THEN 1 ELSE 0 END) AS needs_input
         FROM agent_sessions
         WHERE status = 'running'
         GROUP BY feature_id`,
      )
      .all() as Array<{ feature_id: number; needs_input: number }>;
    const result: Record<number, 'claude' | 'askUser'> = {};
    for (const row of rows) {
      result[row.feature_id] = row.needs_input === 1 ? 'askUser' : 'claude';
    }
    return result;
  }),

  /** Get supported slash commands (from active subprocess or temporary one) */
  getSupportedCommands: publicProcedure
    .input(z.object({
      subprocessId: z.string().nullish(),
      featureId: z.number(),
      projectId: z.number(),
    }))
    .query(async ({ input }) => {
      const { cwd } = resolveAgentCwd(input.featureId, input.projectId);
      return getSupportedCommands(input.subprocessId ?? null, cwd);
    }),

  /** Save a draft prompt for a specific agent session */
  saveDraft: publicProcedure
    .input(z.object({ sessionId: z.number(), draft: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("UPDATE agent_sessions SET draft_prompt = ? WHERE id = ?")
        .run(input.draft, input.sessionId);
      return { success: true };
    }),

  /** Get the draft prompt for a specific agent session */
  getDraft: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const row = db
        .prepare("SELECT draft_prompt FROM agent_sessions WHERE id = ?")
        .get(input.sessionId) as { draft_prompt: string | null } | undefined;
      return { draftPrompt: row?.draft_prompt ?? null };
    }),

  /** Get in-memory background tasks for a subprocess */
  getBackgroundTasks: publicProcedure
    .input(z.object({ subprocessId: z.string() }))
    .query(({ input }) => {
      return getBackgroundTasks(input.subprocessId);
    }),

  /** Ask the agent subprocess to kill a background task */
  killBackgroundTask: publicProcedure
    .input(
      z.object({
        subprocessId: z.string(),
        taskId: z.string(),
        kind: z.enum(["bash", "agent"]),
      }),
    )
    .mutation(({ input }) => {
      const message = input.kind === "bash"
        ? `Please stop the background bash task with shell ID "${input.taskId}" by running KillBash with shell_id="${input.taskId}".`
        : `Please stop the background task with task ID "${input.taskId}" by running TaskStop with task_id="${input.taskId}".`;
      const result = sendMessageToSubprocess(input.subprocessId, message);
      return result;
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

      // Get branch prefix from project column (default: "feature/")
      const prefixRow = db
        .prepare("SELECT branch_prefix FROM projects WHERE id = ?")
        .get(input.projectId) as { branch_prefix: string | null } | undefined;
      const prefix = prefixRow?.branch_prefix ?? "feature/";

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

  /** Get git diff stats (LOC changed) for a feature's worktree or project path */
  getStats: publicProcedure
    .input(z.object({
      featureId: z.number(),
      mode: z.enum(["worktree", "branch"]).optional(),
      targetBranch: z.string().optional(),
    }))
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return { filesChanged: 0, insertions: 0, deletions: 0 };
      return getGitStats(gitPath, input.mode ?? "worktree", input.targetBranch);
    }),

  /** Get the current branch for a project */
  getBranch: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) return null;
      return getCurrentBranch(project.path);
    }),

  /** Get raw unified diff for a feature */
  getDiff: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return "";
      return getDiff(gitPath, input.mode, input.targetBranch);
    }),

  /** Get list of changed files with per-file line counts */
  getChangedFiles: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return [];
      return getChangedFiles(gitPath, input.mode, input.targetBranch);
    }),

  /** Retry worktree setup for a feature */
  retryWorktreeSetup: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(({ input }) => {
      setupWorktreeForFeature(input.projectId, input.featureId).catch((err) => {
        console.error("[retryWorktreeSetup] Failed:", err);
      });
      return { success: true };
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

  /** List all git-tracked files for a feature's worktree/project */
  listFiles: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return [];
      const output = execSync("git ls-files", { cwd: gitPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
      return output.split("\n").filter(Boolean);
    }),

  /** Get the original branch from which the feature's worktree branch was created */
  getOriginalBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      const originalBranch = await getOriginalBranch(project.path, branchRow.value);
      return { originalBranch, worktreeBranch: branchRow.value };
    }),

  /** Check if merging the feature branch into its original branch would conflict */
  checkMergeConflicts: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      const targetBranch = await getOriginalBranch(project.path, branchRow.value);
      return checkMergeConflicts(project.path, branchRow.value, targetBranch);
    }),

  /** Merge the feature branch into its original branch using --no-ff */
  mergeFeatureBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      const targetBranch = await getOriginalBranch(project.path, branchRow.value);
      return mergeBranch(project.path, branchRow.value, targetBranch);
    }),

  /** Delete the feature's local branch (-d, safe — only if fully merged) */
  deleteFeatureBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      return deleteLocalBranch(project.path, branchRow.value);
    }),

  /** Get blob SHAs for all changed files in a feature's worktree */
  getFileBlobShas: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const wtRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow?.value) return {};

      const worktreePath = wtRow.value;
      const result: Record<string, string> = {};

      try {
        // Get list of changed files using git diff (uncommitted)
        const changedFiles = execSync("git diff HEAD --name-only", {
          cwd: worktreePath,
          encoding: "utf-8",
        })
          .trim()
          .split("\n")
          .filter(Boolean);

        // Also include untracked files
        const untrackedFiles = execSync("git ls-files --others --exclude-standard", {
          cwd: worktreePath,
          encoding: "utf-8",
        })
          .trim()
          .split("\n")
          .filter(Boolean);

        // Also include files changed between the branch and its merge-base (committed changes)
        let branchChangedFiles: string[] = [];
        try {
          const branchRow = db
            .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
            .get(input.featureId) as SettingRow | undefined;
          if (branchRow?.value) {
            const mergeBase = execSync(`git merge-base HEAD main || git merge-base HEAD master`, {
              cwd: worktreePath,
              encoding: "utf-8",
              shell: "/bin/sh",
            }).trim();
            if (mergeBase) {
              branchChangedFiles = execSync(`git diff ${mergeBase} HEAD --name-only`, {
                cwd: worktreePath,
                encoding: "utf-8",
              })
                .trim()
                .split("\n")
                .filter(Boolean);
            }
          }
        } catch {
          // merge-base may fail, that's ok
        }

        const allFiles = [...new Set([...changedFiles, ...untrackedFiles, ...branchChangedFiles])];

        for (const filePath of allFiles) {
          try {
            // For tracked files, hash the current working tree version
            const blobSha = execSync(`git hash-object "${filePath}"`, {
              cwd: worktreePath,
              encoding: "utf-8",
            }).trim();
            if (blobSha) {
              result[filePath] = blobSha;
            }
          } catch {
            // For committed files not in worktree, hash from HEAD
            try {
              const blobSha = execSync(`git rev-parse HEAD:"${filePath}"`, {
                cwd: worktreePath,
                encoding: "utf-8",
              }).trim();
              if (blobSha) {
                result[filePath] = blobSha;
              }
            } catch {
              // File might not exist, skip
            }
          }
        }
      } catch {
        // If git commands fail, return empty map
      }

      return result;
    }),

  /** Check if the feature's worktree has uncommitted/untracked changes */
  hasUncommittedChanges: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const wtRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow?.value) return { hasChanges: false };
      const hasChanges = await hasUncommittedChanges(wtRow.value);
      return { hasChanges };
    }),

  /** Delete the feature's worktree (only if no uncommitted changes) */
  deleteWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const wtRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow?.value) throw new Error("No worktree found for this feature");

      const hasChanges = await hasUncommittedChanges(wtRow.value);
      if (hasChanges) {
        return { success: false, error: "Worktree has uncommitted or untracked changes" };
      }

      try {
        removeWorktree(project.path, wtRow.value);
        db.prepare(
          "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
        ).run(input.featureId);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  listProjectWorktrees: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      let worktrees;
      try {
        worktrees = listWorktrees(project.path);
      } catch {
        return [];
      }

      // Filter out the main worktree (repo root)
      const repoRoot = project.path.replace(/\/+$/, "");
      const secondary = worktrees.filter(
        (w) => w.path.replace(/\/+$/, "") !== repoRoot && !w.isBare,
      );

      // For each worktree, look up associated feature
      const featureLookup = db
        .prepare(
          `SELECT fs.value AS worktree_path, f.id AS feature_id, f.title AS feature_title, f.status AS feature_status
           FROM feature_settings fs
           JOIN features f ON f.id = fs.feature_id
           WHERE fs.key = 'worktree_path' AND f.project_id = ?`,
        )
        .all(input.projectId) as Array<{
        worktree_path: string;
        feature_id: number;
        feature_title: string;
        feature_status: string;
      }>;

      const byPath = new Map(featureLookup.map((r) => [r.worktree_path, r]));

      return secondary.map((w) => {
        const feat = byPath.get(w.path);
        return {
          path: w.path,
          branch: w.branch,
          head: w.head,
          featureId: feat?.feature_id ?? null,
          featureTitle: feat?.feature_title ?? null,
          featureStatus: feat?.feature_status ?? null,
        };
      });
    }),

  removeOrphanWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), worktreePath: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      try {
        removeWorktree(project.path, input.worktreePath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
});

const promptHistoryRouter = router({
  /** Get the last 100 prompt history entries for a project (most recent first) */
  getHistory: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const rows = db
        .prepare(
          "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
        )
        .all(input.projectId) as Array<{ content: string }>;
      return rows.map((r) => r.content);
    }),

  /** Add a new entry to the prompt history for a project (with dedup and 100-entry cap) */
  addEntry: publicProcedure
    .input(z.object({ projectId: z.number(), content: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();

      // Dedup: skip if the most recent entry has the same content
      const latest = db
        .prepare(
          "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(input.projectId) as { content: string } | undefined;

      if (latest?.content === input.content) {
        return { success: true, skipped: true };
      }

      // Insert new entry
      db.prepare(
        "INSERT INTO prompt_history (project_id, content) VALUES (?, ?)",
      ).run(input.projectId, input.content);

      // Trim to 100 entries: delete everything beyond the newest 100
      db.prepare(
        "DELETE FROM prompt_history WHERE project_id = ? AND id NOT IN (SELECT id FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100)",
      ).run(input.projectId, input.projectId);

      return { success: true, skipped: false };
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
  diffComments: diffCommentsRouter,
  diffViewed: diffViewedRouter,
  usage: usageRouter,
  terminal: terminalRouter,
  promptHistory: promptHistoryRouter,
});

export type AppRouter = typeof appRouter;
