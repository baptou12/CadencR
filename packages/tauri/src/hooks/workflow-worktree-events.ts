import { invalidateWorktreeQueries } from "@/lib/worktreeQueries";
import type { WorkflowState } from "@/types/workflow";

type WorkflowSetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;

export function handleWorkflowWorktreeEvent(
  action: string,
  payload: Record<string, unknown>,
  set: WorkflowSetFn,
): void {
  switch (action) {
    case "worktree.creating":
      set({
        worktreeStatus: "creating",
        worktreeBranch: (payload.branch as string) ?? null,
        worktreePath: (payload.path as string) ?? null,
        worktreeError: null,
      });
      break;
    case "worktree.created":
      invalidateWorktreeQueries();
      set({
        worktreeStatus: "created",
        worktreePath: (payload.path as string) ?? null,
        worktreeBranch: (payload.branch as string) ?? null,
      });
      break;
    case "worktree.setup_running":
      set({ worktreeStatus: "setup_running" });
      break;
    case "worktree.setup_output": {
      const line = payload.line as string;
      if (line != null)
        set((state) => ({ worktreeSetupOutput: [...state.worktreeSetupOutput, line] }));
      break;
    }
    case "worktree.ready":
      set({ worktreeStatus: "ready" });
      break;
    case "worktree.setup_error":
      set({
        worktreeStatus: "setup_error",
        worktreeError: (payload.error ?? payload.message ?? "") as string,
      });
      break;
  }
}
