import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { ProjectRow, AgentSessionRow } from "../db/types";
import {
  startSubprocess,
  stopSubprocess,
  interruptSubprocess,
  listSubprocesses,
  submitUserAnswers,
  submitPlanApproval,
  submitPrdApproval,
  submitToolPermission,
  sendMessageToSubprocess,
  setSubprocessPermissionMode,
} from "../agents/subprocess-manager";
import { notifyDbUpdated } from "../agents/session-persistence";
import type { AgentType } from "../agents/types";
import { startUnifiedAgent } from "../agents/unified-agent";
import { buildPhaseCompletionAction } from "../agents/execute-agent";
import { buildMcpServerFactoryForResume } from "../agents/mcp-factory";
import { resolveAgentCwd } from "../agents/resolve-cwd";
import { agentTypeSchema } from "./shared";

export const agentsRouter = router({
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
      let cwd: string;
      let worktreePath: string | undefined;
      if (input.agentType === "session") {
        const wtRow = db
          .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
          .get(input.featureId) as { value: string } | undefined;
        if (wtRow?.value) {
          cwd = wtRow.value;
          worktreePath = wtRow.value;
        } else {
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

      const mcpServerFactory = buildMcpServerFactoryForResume(
        input.agentType as AgentType,
        input.featureId,
        originalSession?.phase_id,
      );

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
        mcpServerFactory,
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

  /** Store plan approval/rejection in DB when subprocess is gone (paused/dead) — consumed on resume */
  storePlanApproval: publicProcedure
    .input(z.object({ sessionDbId: z.number(), approved: z.boolean(), feedback: z.string().optional() }))
    .mutation(({ input }) => {
      try {
        const db = getDatabase();
        db.prepare("UPDATE agent_sessions SET plan_approval_result = ?, pending_plan_approval = NULL WHERE id = ?")
          .run(JSON.stringify({ approved: input.approved, feedback: input.feedback }), input.sessionDbId);
        if (input.approved) {
          db.prepare("UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE id = ?").run(input.sessionDbId);
        }
        const row = db.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(input.sessionDbId) as { feature_id: number } | undefined;
        if (row) notifyDbUpdated("agent_session", row.feature_id);
        return { success: true };
      } catch {
        return { success: false };
      }
    }),

  /** Submit PRD approval or rejection for a pending show_prd tool call */
  submitPrdApproval: publicProcedure
    .input(
      z.object({
        subprocessId: z.string(),
        approved: z.boolean(),
        feedback: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      return submitPrdApproval(input.subprocessId, input.approved, input.feedback);
    }),

  /** Clear a stale pending_prd_approval (e.g. when subprocess is gone after restart) */
  clearPrdApproval: publicProcedure
    .input(z.object({ sessionDbId: z.number() }))
    .mutation(({ input }) => {
      try {
        const db = getDatabase();
        db.prepare("UPDATE agent_sessions SET pending_prd_approval = NULL WHERE id = ?").run(input.sessionDbId);
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
      db.prepare("UPDATE agent_sessions SET permission_mode = ? WHERE id = ?")
        .run(input.mode, input.sessionId);
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
});
