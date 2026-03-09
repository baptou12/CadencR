import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import type { AgentSessionRow, AgentMessageRow } from "../db/types";
import { queryOne, queryAll, execute, transaction } from "../db/query";
import { Effect } from "effect";
import { AppRuntime } from "../effect/runtime";
import {
  stopSubprocess,
  interruptSubprocess,
  listSubprocesses,
  getSupportedCommands,
  sendMessageToSubprocess,
} from "../agents/subprocess-manager";
import { getBackgroundTasks } from "../agents/background-tasks";
import { getSubprocessIdForSession, notifyDbUpdated } from "../agents/effect-helpers";
import type { AgentType } from "../agents/types";
import { resolveAgentCwd } from "../agents/resolve-cwd";
import { buildBlocks } from "./shared";

export const sessionsRouter = router({
  /** Get sessions for a feature (optionally filter by status) */
  getSessions: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        status: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const sql = `SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at, run_id, phase_id, model FROM agent_sessions WHERE feature_id = ?${input.status ? " AND status = ?" : ""} ORDER BY id DESC`;
      const params: (number | string)[] = input.status
        ? [input.featureId, input.status]
        : [input.featureId];
      return await AppRuntime.runPromise(queryAll<AgentSessionRow>(sql, ...params));
    }),

  /** Stop a running agent by its DB session ID (used when subprocess ID is unknown after refresh) */
  stopBySessionId: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const session = await AppRuntime.runPromise(
        queryOne<Pick<AgentSessionRow, "subprocess_id" | "status"> & { feature_id: number }>(
          "SELECT subprocess_id, status, feature_id FROM agent_sessions WHERE id = ?",
          input.sessionId,
        ),
      );
      if (!session) return { success: false };

      // Try to stop the subprocess if it's still alive
      if (session.subprocess_id) {
        await stopSubprocess(session.subprocess_id);
      }

      // Mark as completed if still running/paused
      const current = await AppRuntime.runPromise(
        queryOne<Pick<AgentSessionRow, "status">>(
          "SELECT status FROM agent_sessions WHERE id = ?",
          input.sessionId,
        ),
      );
      if (current && (current.status === "running" || current.status === "paused")) {
        await AppRuntime.runPromise(execute(
          "UPDATE agent_sessions SET status = 'completed', ended_at = ?, subprocess_id = NULL WHERE id = ?",
          new Date().toISOString(), input.sessionId,
        ));
        if (session.feature_id) notifyDbUpdated("agent_session", session.feature_id);
      }
      return { success: true };
    }),

  /** Interrupt a running agent by its DB session ID */
  interruptBySessionId: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const session = await AppRuntime.runPromise(
        queryOne<Pick<AgentSessionRow, "subprocess_id">>(
          "SELECT subprocess_id FROM agent_sessions WHERE id = ?",
          input.sessionId,
        ),
      );
      if (!session?.subprocess_id) return { success: false };
      const interrupted = await interruptSubprocess(session.subprocess_id);
      return { success: interrupted };
    }),

  /** Delete an agent session and its messages (only non-running, non-completed) */
  deleteSession: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ input }) => {
      const session = await AppRuntime.runPromise(
        queryOne<Pick<AgentSessionRow, "id" | "status">>(
          "SELECT id, status FROM agent_sessions WHERE id = ?",
          input.sessionId,
        ),
      );
      if (!session) throw new Error("Session not found");
      if (session.status === "completed" || session.status === "running") {
        throw new Error("Cannot delete a completed or running session");
      }
      await AppRuntime.runPromise(
        transaction(() => {
          Effect.runSync(execute("DELETE FROM agent_messages WHERE session_id = ?", input.sessionId));
          Effect.runSync(execute("DELETE FROM agent_sessions WHERE id = ?", input.sessionId));
        }),
      );
      return { success: true };
    }),

  /** Get the active subprocess ID for a feature's session (if still alive) */
  getActiveSessionProcess: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      const session = await AppRuntime.runPromise(
        queryOne<{ id: number }>(
          "SELECT id FROM agent_sessions WHERE feature_id = ? AND agent_type = 'session' AND status = 'running' ORDER BY id DESC LIMIT 1",
          input.featureId,
        ),
      );
      if (!session) return null;
      const subprocessId = getSubprocessIdForSession(session.id);
      if (!subprocessId) return null;
      const active = listSubprocesses().find((s) => s.id === subprocessId);
      if (!active || active.status === "completed" || active.status === "error" || active.status === "stopped") return null;
      return { subprocessId, sessionDbId: session.id, status: active.status };
    }),

  /** Get all agent state for a feature in a single query */
  getFeatureAgentState: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      const sessions = await AppRuntime.runPromise(
        queryAll<AgentSessionRow & { draft_prompt: string | null }>(
          "SELECT id, feature_id, agent_type, claude_session_id, status, started_at, ended_at, run_id, phase_id, subprocess_id, model, pending_questions, has_file_changes, permission_mode, pending_plan_approval, pending_prd_approval, pending_permission, input_tokens, output_tokens, context_window, was_compacted, draft_prompt FROM agent_sessions WHERE feature_id = ? ORDER BY id ASC",
          input.featureId,
        ),
      );

      if (sessions.length === 0) return { sessions: [] };

      // Batch-fetch phase titles for execute sessions
      const phaseIds = sessions.map((s) => s.phase_id).filter((id): id is number => id != null);
      const phaseTitleMap = new Map<number, string>();
      if (phaseIds.length > 0) {
        const phPlaceholders = phaseIds.map(() => "?").join(",");
        const phases = await AppRuntime.runPromise(
          queryAll<{ id: number; title: string }>(
            `SELECT id, title FROM phases WHERE id IN (${phPlaceholders})`,
            ...phaseIds,
          ),
        );
        for (const p of phases) {
          phaseTitleMap.set(p.id, p.title);
        }
      }

      // Batch-fetch all messages for these sessions
      const sessionIds = sessions.map((s) => s.id);
      const placeholders = sessionIds.map(() => "?").join(",");
      const allMessages = await AppRuntime.runPromise(
        queryAll<AgentMessageRow>(
          `SELECT id, session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id IN (${placeholders}) ORDER BY id ASC`,
          ...sessionIds,
        ),
      );

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
            pendingPrdApproval: s.pending_prd_approval ? (() => { try { return JSON.parse(s.pending_prd_approval); } catch { return null; } })() : null,
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
  getActiveFeatureIds: publicProcedure.query(async () => {
    const rows = await AppRuntime.runPromise(
      queryAll<{ feature_id: number }>(
        "SELECT DISTINCT feature_id FROM agent_sessions WHERE status = 'running'",
      ),
    );
    return rows.map((r) => r.feature_id);
  }),

  /** Get turn states for features with running sessions */
  getFeatureTurnStates: publicProcedure.query(async () => {
    const rows = await AppRuntime.runPromise(
      queryAll<{ feature_id: number; needs_input: number }>(
        `SELECT feature_id,
          MAX(CASE WHEN pending_questions IS NOT NULL OR pending_permission IS NOT NULL OR pending_plan_approval IS NOT NULL OR pending_prd_approval IS NOT NULL THEN 1 ELSE 0 END) AS needs_input
         FROM agent_sessions
         WHERE status = 'running'
         GROUP BY feature_id`,
      ),
    );
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
      const { cwd } = await resolveAgentCwd(input.featureId, input.projectId);
      return getSupportedCommands(input.subprocessId ?? null, cwd);
    }),

  /** Save a draft prompt for a specific agent session */
  saveDraft: publicProcedure
    .input(z.object({ sessionId: z.number(), draft: z.string().nullable() }))
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute(
        "UPDATE agent_sessions SET draft_prompt = ? WHERE id = ?",
        input.draft, input.sessionId,
      ));
      return { success: true };
    }),

  /** Get the draft prompt for a specific agent session */
  getDraft: publicProcedure
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const row = await AppRuntime.runPromise(
        queryOne<{ draft_prompt: string | null }>(
          "SELECT draft_prompt FROM agent_sessions WHERE id = ?",
          input.sessionId,
        ),
      );
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
