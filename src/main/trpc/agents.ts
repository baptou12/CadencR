import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./trpc";
import type { ProjectRow, AgentSessionRow } from "../db/types";
import { queryOne, execute, transaction } from "../db/query";
import { Effect } from "effect";
import { AppRuntime } from "../effect/runtime";
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
import { notifyDbUpdated } from "../agents/effect-helpers";
import type { AgentType } from "../agents/types";
import { startUnifiedAgent } from "../agents/unified-agent";
import { buildPhaseCompletionAction, processNextPhase } from "../agents/execute-agent";
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
        sessionId: z.string().optional(),
        originalSessionDbId: z.number(),
        prompt: z.string().optional(),
        images: z.array(z.object({ base64: z.string(), mimeType: z.string() })).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Build an Effect to resolve cwd depending on agent type
      const cwdEffect = input.agentType === "session"
        ? Effect.gen(function* () {
            const wtRow = yield* queryOne<{ value: string }>(
              "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
              input.featureId,
            );
            if (wtRow?.value) return { cwd: wtRow.value, worktreePath: wtRow.value as string | undefined };
            const project = yield* queryOne<Pick<ProjectRow, "path">>(
              "SELECT path FROM projects WHERE id = ?",
              input.projectId,
            );
            if (!project?.path) throw new TRPCError({ code: "NOT_FOUND", message: "Project path not found" });
            return { cwd: project.path, worktreePath: undefined as string | undefined };
          })
        : resolveAgentCwd(input.featureId, input.projectId);

      // Compose cwd resolution + session query + pending_questions clear into one Effect
      const { cwd, worktreePath, originalSession } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const { cwd, worktreePath } = yield* cwdEffect;
          const originalSession = yield* queryOne<Pick<AgentSessionRow, "run_id" | "phase_id">>(
            "SELECT run_id, phase_id FROM agent_sessions WHERE id = ?",
            input.originalSessionDbId,
          );
          // Clear any pending questions — the user's answer is now the resume prompt
          yield* execute(
            "UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?",
            input.originalSessionDbId,
          );
          return { cwd, worktreePath, originalSession };
        }),
      );

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

      const onAgentDone: import("../agents/mcp-tools").OnAgentDoneCallback = (opts) => {
        processNextPhase({ featureId: opts.featureId, projectId: opts.projectId, cwd: opts.cwd, worktreePath: opts.worktreePath ?? undefined });
      };
      const mcpServerFactory = buildMcpServerFactoryForResume(
        input.agentType as AgentType,
        input.featureId,
        originalSession?.phase_id,
        onAgentDone,
      );

      const result = await startUnifiedAgent({
        agentType: input.agentType as AgentType,
        featureId: input.featureId,
        projectId: input.projectId,
        cwd,
        prompt: resumePrompt,
        resumeSessionId: input.sessionId ?? undefined,
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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          yield* execute(
            "UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?",
            input.sessionDbId,
          );
          const row = yield* queryOne<{ feature_id: number }>(
            "SELECT feature_id FROM agent_sessions WHERE id = ?",
            input.sessionDbId,
          );
          if (row) notifyDbUpdated("agent_session", row.feature_id);
          return { success: true as const };
        }).pipe(
          Effect.catchAll(() => Effect.succeed({ success: false as const })),
        ),
      );
    }),

  /** Store plan approval/rejection in DB when subprocess is gone (paused/dead) — consumed on resume */
  storePlanApproval: publicProcedure
    .input(z.object({ sessionDbId: z.number(), approved: z.boolean(), feedback: z.string().optional() }))
    .mutation(({ input }) => {
      return AppRuntime.runPromise(
        transaction(() => {
          Effect.runSync(execute(
            "UPDATE agent_sessions SET plan_approval_result = ?, pending_plan_approval = NULL WHERE id = ?",
            JSON.stringify({ approved: input.approved, feedback: input.feedback }), input.sessionDbId,
          ));
          if (input.approved) {
            Effect.runSync(execute(
              "UPDATE agent_sessions SET permission_mode = 'acceptEdits' WHERE id = ?",
              input.sessionDbId,
            ));
          }
          return Effect.runSync(queryOne<{ feature_id: number }>(
            "SELECT feature_id FROM agent_sessions WHERE id = ?",
            input.sessionDbId,
          ));
        }).pipe(
          Effect.map((row) => {
            if (row) notifyDbUpdated("agent_session", row.feature_id);
            return { success: true as const };
          }),
          Effect.catchAll(() => Effect.succeed({ success: false as const })),
        ),
      );
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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          yield* execute(
            "UPDATE agent_sessions SET pending_prd_approval = NULL WHERE id = ?",
            input.sessionDbId,
          );
          const row = yield* queryOne<{ feature_id: number }>(
            "SELECT feature_id FROM agent_sessions WHERE id = ?",
            input.sessionDbId,
          );
          if (row) notifyDbUpdated("agent_session", row.feature_id);
          return { success: true as const };
        }).pipe(
          Effect.catchAll(() => Effect.succeed({ success: false as const })),
        ),
      );
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
      return await sendMessageToSubprocess(input.id, content);
    }),

  /** Clear session context — inserts a divider, archives the session ID, and resets for fresh start */
  clearSession: publicProcedure
    .input(z.object({
      subprocessId: z.string().optional(),
      sessionDbId: z.number(),
    }))
    .mutation(async ({ input }) => {
      // 1. Archive current claude_session_id and insert clear_divider atomically.
      //    These two must be committed before stopSubprocess runs so the archive
      //    is durable regardless of what pauseSubprocess writes to DB afterwards.
      const session = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const s = yield* queryOne<{ claude_session_id: string | null; feature_id: number }>(
            "SELECT claude_session_id, feature_id FROM agent_sessions WHERE id = ?",
            input.sessionDbId,
          );
          if (!s) return null;
          yield* transaction(() => {
            if (s.claude_session_id) {
              Effect.runSync(execute(
                "INSERT INTO session_claude_ids (session_id, claude_session_id) VALUES (?, ?)",
                input.sessionDbId, s.claude_session_id,
              ));
            }
            Effect.runSync(execute(
              "INSERT INTO agent_messages (session_id, role, content, message_type) VALUES (?, 'system', 'clear_boundary', 'clear_divider')",
              input.sessionDbId,
            ));
          });
          return s;
        }),
      );

      if (!session) return { success: false, reason: "session_not_found" };

      // 2. Stop the subprocess — this clears subprocess_id from DB and pauses it.
      //    IMPORTANT: pauseSubprocess re-persists managed.sdkSessionId to DB,
      //    so we must null out claude_session_id AFTER stopping.
      if (input.subprocessId) {
        await stopSubprocess(input.subprocessId);
      }

      // 3. Null out claude_session_id AFTER stop so pauseSubprocess can't overwrite it
      await AppRuntime.runPromise(execute(
        "UPDATE agent_sessions SET claude_session_id = NULL WHERE id = ?",
        input.sessionDbId,
      ));

      // 4. Broadcast update
      notifyDbUpdated("agent_session", session.feature_id);
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
      const session = await AppRuntime.runPromise(
        Effect.gen(function* () {
          yield* execute(
            "UPDATE agent_sessions SET permission_mode = ? WHERE id = ?",
            input.mode, input.sessionId,
          );
          return yield* queryOne<Pick<AgentSessionRow, "subprocess_id">>(
            "SELECT subprocess_id FROM agent_sessions WHERE id = ?",
            input.sessionId,
          );
        }),
      );
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
