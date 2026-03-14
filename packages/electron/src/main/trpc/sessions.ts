import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./trpc";
import type { AgentSessionRow } from "../db/types";
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
import { BackgroundTaskRegistry } from "../effect/services/BackgroundTaskRegistry";
import { getSubprocessIdForSession, notifyDbUpdated } from "../agents/effect-helpers";
import { resolveAgentCwd } from "../agents/resolve-cwd";

export const sessionsRouter = router({
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

  /** Get feature IDs that have running agent sessions */
  getActiveFeatureIds: publicProcedure.query(async () => {
    const rows = await AppRuntime.runPromise(
      queryAll<{ feature_id: number }>(
        "SELECT DISTINCT feature_id FROM agent_sessions WHERE status = 'running'",
      ),
    );
    return rows.map((r) => r.feature_id);
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
