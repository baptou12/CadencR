import { updateSession } from "./ws-session-types";
import type { SessionEntry, WsSessionStore } from "./ws-session-types";
import { invalidateWorktreeQueries } from "@/lib/worktreeQueries";

interface WorktreeStoreAccessors {
  get: () => WsSessionStore;
  set: (partial: Partial<WsSessionStore>) => void;
  getSession: (sessionId: string) => SessionEntry;
}

export function handleWorktreeEvent(
  ctx: WorktreeStoreAccessors,
  sessionId: string,
  action: string,
  payload: unknown,
): void {
  const value = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const payloadString = (key: string): string | null =>
    typeof value[key] === "string" ? (value[key] as string) : null;

  switch (action) {
    case "worktree.creating":
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          worktreeStatus: "creating",
          worktreeBranch: payloadString("branch"),
          worktreePath: payloadString("path"),
          worktreeError: null,
        }),
      );
      break;
    case "worktree.created":
      invalidateWorktreeQueries();
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          worktreeStatus: "created",
          worktreeBranch: payloadString("branch"),
          worktreePath: payloadString("path"),
        }),
      );
      break;
    case "worktree.setup_running":
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          worktreeStatus: "setup_running",
          worktreeError: null,
          worktreeSetupOutput: [],
        }),
      );
      break;
    case "worktree.setup_output": {
      const session = ctx.getSession(sessionId);
      const line = payloadString("line");
      if (!line) break;
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          worktreeSetupOutput: [...session.worktreeSetupOutput, line],
        }),
      );
      break;
    }
    case "worktree.ready":
      ctx.set(
        updateSession(ctx.get(), sessionId, { worktreeStatus: "ready", worktreeError: null }),
      );
      break;
    case "worktree.setup_error": {
      const session = ctx.getSession(sessionId);
      const output = payloadString("output");
      const shouldHydrateOutput = output != null && session.worktreeSetupOutput.length === 0;
      ctx.set(
        updateSession(ctx.get(), sessionId, {
          worktreeStatus: "setup_error",
          worktreeError: payloadString("error") ?? payloadString("message"),
          ...(shouldHydrateOutput ? { worktreeSetupOutput: output.split("\n") } : {}),
        }),
      );
      break;
    }
  }
}
