import { invalidateWorktreeQueries } from "@/lib/worktreeQueries";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import type { WorkflowState } from "@/types/workflow";

type WorkflowSetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;

type WorkflowGetFn = () => WorkflowState;

export function handleWorkflowWorktreeEvent(
  action: string,
  payload: Record<string, unknown>,
  set: WorkflowSetFn,
  get?: WorkflowGetFn,
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
      bumpWatcherEpochForFeature(payload, get);
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
      bumpWatcherEpochForFeature(payload, get);
      break;
    case "worktree.setup_error":
      set({
        worktreeStatus: "setup_error",
        worktreeError: (payload.error ?? payload.message ?? "") as string,
      });
      break;
  }
}

/**
 * Mirror the ws-session bump in `ws-envelope-handler.ts`: when the backend
 * announces `worktree.created` / `worktree.ready`, force any mounted
 * `useGitStatusSubscription` for this feature to re-issue its subscribe
 * envelope. Without this, FeatureWorkflowView stays bound to the
 * pre-worktree path and shows stale/wrong git status. Prefer the explicit
 * `feature_id` from the payload (it's the authoritative one); fall back to
 * the workflow store's `featureId` since the workflow socket is per-feature.
 */
function bumpWatcherEpochForFeature(
  payload: Record<string, unknown>,
  get: WorkflowGetFn | undefined,
): void {
  const fromPayload = typeof payload.feature_id === "number" ? payload.feature_id : null;
  const featureId = fromPayload ?? get?.().featureId ?? null;
  if (featureId == null) return;
  useGitStatusStore.getState().bumpWatcherEpoch(featureId);
}
