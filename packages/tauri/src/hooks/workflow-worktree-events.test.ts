/**
 * Tests for `handleWorkflowWorktreeEvent`.
 *
 * The handler doubles as the workflow-side mirror of `ws-envelope-handler`'s
 * `bumpWatcherEpoch` call: when `worktree.created` / `worktree.ready`
 * arrives we must force any mounted `useGitStatusSubscription` for that
 * feature to re-resolve its backend watcher, otherwise the workflow view
 * keeps subscribing against the pre-worktree path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const bumpWatcherEpoch = vi.fn();

vi.mock("@/stores/useGitStatusStore", () => ({
  useGitStatusStore: {
    getState: (): { bumpWatcherEpoch: typeof bumpWatcherEpoch } => ({ bumpWatcherEpoch }),
  },
}));

vi.mock("@/lib/worktreeQueries", () => ({
  invalidateWorktreeQueries: vi.fn(),
}));

import { handleWorkflowWorktreeEvent } from "./workflow-worktree-events";
import type { WorkflowState } from "@/types/workflow";

type WorkflowSetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;

beforeEach(() => {
  bumpWatcherEpoch.mockClear();
});

function makeSet(): { set: WorkflowSetFn; calls: unknown[] } {
  const calls: unknown[] = [];
  const set: WorkflowSetFn = (partial) => {
    calls.push(partial);
  };
  return { set, calls };
}

describe("handleWorkflowWorktreeEvent — watcher epoch bump", () => {
  it("bumps watcher epoch on worktree.created using payload feature_id", () => {
    const { set } = makeSet();
    handleWorkflowWorktreeEvent(
      "worktree.created",
      { feature_id: 42, path: "/tmp/wt", branch: "feat" },
      set,
    );
    expect(bumpWatcherEpoch).toHaveBeenCalledTimes(1);
    expect(bumpWatcherEpoch).toHaveBeenCalledWith(42);
  });

  it("bumps watcher epoch on worktree.ready using payload feature_id", () => {
    const { set } = makeSet();
    handleWorkflowWorktreeEvent("worktree.ready", { feature_id: 7 }, set);
    expect(bumpWatcherEpoch).toHaveBeenCalledTimes(1);
    expect(bumpWatcherEpoch).toHaveBeenCalledWith(7);
  });

  it("falls back to workflow store featureId when payload omits it", () => {
    const { set } = makeSet();
    const get = (): WorkflowState => ({ featureId: 99 }) as unknown as WorkflowState;
    handleWorkflowWorktreeEvent("worktree.ready", {}, set, get);
    expect(bumpWatcherEpoch).toHaveBeenCalledWith(99);
  });

  it("does not bump on non-(created|ready) actions", () => {
    const { set } = makeSet();
    handleWorkflowWorktreeEvent(
      "worktree.creating",
      { feature_id: 5, branch: "feat", path: "/x" },
      set,
    );
    handleWorkflowWorktreeEvent("worktree.setup_running", { feature_id: 5 }, set);
    handleWorkflowWorktreeEvent("worktree.setup_output", { feature_id: 5, line: "hi" }, set);
    handleWorkflowWorktreeEvent("worktree.setup_error", { feature_id: 5, error: "boom" }, set);
    expect(bumpWatcherEpoch).not.toHaveBeenCalled();
  });

  it("is a no-op when no feature_id can be resolved", () => {
    const { set } = makeSet();
    handleWorkflowWorktreeEvent("worktree.created", {}, set);
    expect(bumpWatcherEpoch).not.toHaveBeenCalled();
  });
});
