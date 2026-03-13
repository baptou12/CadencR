import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./trpc";
import type { AgentSessionRow, AgentMessageRow } from "../db/types";
import { queryOne, queryAll, queryAllValidated, execute, transaction } from "../db/query";
import { AgentSessionRowSchema, AgentMessageRowSchema } from "../effect/schemas/db-schemas";
import { Effect } from "effect";
import { AppRuntime } from "../effect/runtime";
import {
  stopSubprocess,
  interruptSubprocess,
  listSubprocesses,
  getSupportedCommands,
  sendMessageToSubprocess,
} from "../agents/subprocess-manager";
import { BackgroundTaskRegistry } from "../effect/services/BackgroundTaskRegistry";
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
      const sql = `SELECT * FROM agent_sessions WHERE feature_id = ?${input.status ? " AND status = ?" : ""} ORDER BY id DESC`;
      const params: (number | string)[] = input.status
        ? [input.featureId, input.status]
        : [input.featureId];
      return await AppRuntime.runPromise(queryAllValidated(AgentSessionRowSchema, sql, ...params));
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

      // Mark as completed if still in a state that can transition to completed.
      // Valid source states per SESSION_TRANSITIONS: running, waiting, paused.
      const completableStatuses = ["running", "waiting", "paused"];
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const current = yield* queryOne<Pick<AgentSessionRow, "status">>(
            "SELECT status FROM agent_sessions WHERE id = ?",
            input.sessionId,
          );
          if (current && completableStatuses.includes(current.status)) {
            console.log(`[session-trace] session ${input.sessionId}: ${current.status} -> completed (stopBySessionId, feature ${session.feature_id})`);
            yield* execute(
              "UPDATE agent_sessions SET status = 'completed', ended_at = ?, subprocess_id = NULL WHERE id = ?",
              new Date().toISOString(), input.sessionId,
            );
            if (session.feature_id) notifyDbUpdated("agent_session", session.feature_id);
          }
        }),
      );
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
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: `Session ${input.sessionId} not found` });
      if (session.status === "completed" || session.status === "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot delete a ${session.status} session` });
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
    .input(z.object({
      featureId: z.number(),
      afterMessageIds: z.record(z.coerce.number(), z.number()).optional(),
    }))
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

      // Split sessions into full-fetch vs incremental groups
      const afterMap = input.afterMessageIds ?? {};
      const fullFetchIds: number[] = [];
      const incrementalFetches: { sessionId: number; afterId: number }[] = [];
      for (const s of sessions) {
        const after = afterMap[s.id];
        if (after != null && after > 0) {
          incrementalFetches.push({ sessionId: s.id, afterId: after });
        } else {
          fullFetchIds.push(s.id);
        }
      }

      // Batch-fetch all messages for full-fetch sessions
      const fullMessagesBySession = new Map<number, AgentMessageRow[]>();
      if (fullFetchIds.length > 0) {
        const placeholders = fullFetchIds.map(() => "?").join(",");
        const allMessages = await AppRuntime.runPromise(
          queryAllValidated(
            AgentMessageRowSchema,
            `SELECT id, session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id IN (${placeholders}) ORDER BY id ASC`,
            ...fullFetchIds,
          ),
        );
        for (const msg of allMessages) {
          let arr = fullMessagesBySession.get(msg.session_id);
          if (!arr) {
            arr = [];
            fullMessagesBySession.set(msg.session_id, arr);
          }
          arr.push(msg);
        }
      }

      // Per-session incremental fetches
      const incrementalMessagesBySession = new Map<number, AgentMessageRow[]>();
      // Tool_call rows whose content was updated in-place (input_json_delta).
      // Keyed by message ID so the client can patch existing blocks.
      const updatedToolCalls = new Map<number, Map<number, AgentMessageRow>>();
      if (incrementalFetches.length > 0) {
        const results = await Promise.all(
          incrementalFetches.map(({ sessionId, afterId }) =>
            AppRuntime.runPromise(
              queryAllValidated(
                AgentMessageRowSchema,
                "SELECT id, session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model FROM agent_messages WHERE session_id = ? AND id > ? ORDER BY id ASC",
                sessionId,
                afterId,
              ),
            ).then((msgs) => ({ sessionId, msgs })),
          ),
        );
        for (const { sessionId, msgs } of results) {
          incrementalMessagesBySession.set(sessionId, msgs);
        }

        // Re-fetch tool_call rows (id <= cursor) whose content may have been
        // updated via input_json_delta after the client originally fetched them.
        // Due to a race condition, the client may have fetched a tool_call with
        // content "{}" before input_json_delta events populated the real args.
        //
        // Previously this query only checked in-flight tool_calls (no tool_result),
        // but fast-completing tools can have their tool_result inserted before the
        // next incremental fetch, leaving the client stuck with empty toolArgs.
        //
        // Now we return ALL previously-fetched tool_calls whose content has been
        // populated (content != '{}'), regardless of whether they have a result.
        // The client-side applyToolCallUpdates() skips no-op updates efficiently.
        const staleResults = await Promise.all(
          incrementalFetches.map(({ sessionId, afterId }) =>
            AppRuntime.runPromise(
              queryAll<AgentMessageRow>(
                `SELECT id, session_id, role, content, message_type, tool_name, tool_use_id, parent_tool_use_id, created_at, model
                 FROM agent_messages
                 WHERE session_id = ? AND id <= ? AND message_type = 'tool_call'
                   AND content != '{}'
                 ORDER BY id ASC`,
                sessionId, afterId,
              ),
            ).then((rows) => ({ sessionId, rows })),
          ),
        );
        for (const { sessionId, rows } of staleResults) {
          if (rows.length > 0) {
            const map = new Map<number, AgentMessageRow>();
            for (const row of rows) map.set(row.id, row);
            updatedToolCalls.set(sessionId, map);
          }
        }
      }

      // Extract todos: for full-fetch sessions, scan in-memory messages.
      // For incremental sessions, query the DB directly for the latest TodoWrite
      // because the row may have been updated in-place (via input_json_delta)
      // after the cursor advanced past it.
      const todosBySession = new Map<number, Array<{ content: string; status: string; activeForm: string }>>();
      const incrementalSessionIds = incrementalFetches.map((f) => f.sessionId);
      if (incrementalSessionIds.length > 0) {
        // Uses idx_agent_messages_session index for fast per-session lookup
        for (const sid of incrementalSessionIds) {
          const row = await AppRuntime.runPromise(
            queryOne<{ content: string }>(
              "SELECT content FROM agent_messages WHERE session_id = ? AND message_type = 'tool_call' AND tool_name = 'TodoWrite' ORDER BY id DESC LIMIT 1",
              sid,
            ),
          );
          if (row) {
            try {
              const parsed = JSON.parse(row.content);
              if (parsed.todos && Array.isArray(parsed.todos)) {
                todosBySession.set(sid, parsed.todos);
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }

      return {
        sessions: sessions.map((s) => {
          let pendingQuestions: unknown = null;
          if (s.pending_questions) {
            try { pendingQuestions = JSON.parse(s.pending_questions); } catch { /* ignore */ }
          }

          const isIncremental = incrementalMessagesBySession.has(s.id);
          const msgs = isIncremental
            ? incrementalMessagesBySession.get(s.id)!
            : fullMessagesBySession.get(s.id) ?? [];
          const maxMessageId = msgs.length > 0
            ? msgs[msgs.length - 1].id
            : (isIncremental ? afterMap[s.id] : 0);

          // For full-fetch sessions, extract todos from in-memory messages
          if (!isIncremental) {
            for (let i = msgs.length - 1; i >= 0; i--) {
              const msg = msgs[i];
              if (msg.message_type === "tool_call" && msg.tool_name === "TodoWrite") {
                try {
                  const parsed = JSON.parse(msg.content);
                  if (parsed.todos && Array.isArray(parsed.todos)) {
                    todosBySession.set(s.id, parsed.todos);
                    break;
                  }
                } catch { /* ignore parse errors */ }
              }
            }
          }

          // Build updated tool call content map for this session (incremental only)
          const toolCallUpdates: Record<string, string> | null =
            isIncremental && updatedToolCalls.has(s.id)
              ? Object.fromEntries(
                  [...updatedToolCalls.get(s.id)!.entries()].map(
                    ([id, row]) => [`msg-${id}`, row.content],
                  ),
                )
              : null;

          return {
            sessionDbId: s.id,
            agentType: s.agent_type as AgentType,
            status: s.status,
            subprocessId: s.subprocess_id,
            model: s.model,
            blocks: buildBlocks(msgs),
            maxMessageId,
            isIncremental,
            toolCallUpdates,
            pendingQuestions,
            hasFileChanges: s.has_file_changes === 1,
            resumable: (s.status === "paused" || s.status === "completed" || s.status === "error") && s.claude_session_id != null,
            claudeSessionId: s.claude_session_id,
            runId: s.run_id,
            phaseId: s.phase_id,
            phaseTitle: s.phase_id != null ? phaseTitleMap.get(s.phase_id) ?? null : null,
            todos: todosBySession.get(s.id) ?? null,
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
      const { cwd } = Effect.runSync(resolveAgentCwd(input.featureId, input.projectId));
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
    .query(async ({ input }) => {
      return await AppRuntime.runPromise(
        BackgroundTaskRegistry.getBySubprocess(input.subprocessId),
      );
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
    .mutation(async ({ input }) => {
      const message = input.kind === "bash"
        ? `Please stop the background bash task with shell ID "${input.taskId}" by running KillBash with shell_id="${input.taskId}".`
        : `Please stop the background task with task ID "${input.taskId}" by running TaskStop with task_id="${input.taskId}".`;
      const result = await sendMessageToSubprocess(input.subprocessId, message);
      return result;
    }),
});
