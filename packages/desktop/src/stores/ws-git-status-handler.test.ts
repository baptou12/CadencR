import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { handleGitEnvelope, parseGitStatusSnapshot } from "./ws-git-status-handler";
import { useGitStatusStore } from "./useGitStatusStore";
import {
  selectCommitOutput,
  selectCommitRunning,
  useCommitOutputStore,
} from "./useCommitOutputStore";
import { selectPushOutput, selectPushRunning, usePushOutputStore } from "./usePushOutputStore";
import { queryClient } from "@/lib/queryClient";

const validSnapshot = {
  feature_id: 7,
  current_branch: "feature/foo",
  target_branch: "main",
  uncommitted_count: 3,
  staged_count: 1,
  unstaged_count: 1,
  untracked_count: 1,
  ahead_of_remote: 0,
  behind_remote: 0,
  ahead_of_target: 2,
  has_remote: true,
  host: "GitHub" as const,
  compare_url: "https://github.com/org/repo/compare/main...feature/foo",
  action_label: "Open PR",
  computed_at: 1_700_000_000_000,
};

beforeEach(() => {
  useGitStatusStore.setState({ byFeature: {}, errorByFeature: {} });
  useCommitOutputStore.setState({ byFeature: {}, runningByFeature: {} });
  usePushOutputStore.setState({ byFeature: {}, runningByFeature: {} });
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseGitStatusSnapshot", () => {
  it("accepts a fully-typed payload", () => {
    expect(parseGitStatusSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it("rejects a payload with the wrong feature_id type", () => {
    expect(parseGitStatusSnapshot({ ...validSnapshot, feature_id: "7" })).toBeNull();
  });

  it("rejects a payload missing has_remote", () => {
    const { has_remote: _omit, ...rest } = validSnapshot;
    expect(parseGitStatusSnapshot(rest)).toBeNull();
  });
});

describe("handleGitEnvelope", () => {
  it("writes a valid status into the store and invalidates git queries", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    handleGitEnvelope("status", validSnapshot as Record<string, unknown>);

    expect(useGitStatusStore.getState().byFeature[7]).toEqual(validSnapshot);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("ignores a malformed status payload (no store write, no toast)", () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    handleGitEnvelope("status", { feature_id: "not-a-number" });

    expect(useGitStatusStore.getState().byFeature).toEqual({});
    expect(spy).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("writes errors and surfaces a toast on status_error", () => {
    handleGitEnvelope("status_error", { feature_id: 7, error: "fatal: not a git repo" });

    expect(useGitStatusStore.getState().errorByFeature[7]).toBe("fatal: not a git repo");
    expect(toast.error).toHaveBeenCalledWith("Git status error: fatal: not a git repo");
  });

  it("clears any prior error when a fresh snapshot arrives", () => {
    useGitStatusStore.getState().setStatusError({ feature_id: 7, error: "boom" });
    expect(useGitStatusStore.getState().errorByFeature[7]).toBe("boom");

    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    handleGitEnvelope("status", validSnapshot as Record<string, unknown>);

    expect(useGitStatusStore.getState().errorByFeature[7]).toBeUndefined();
  });

  it("routes commit lifecycle envelopes into the commit output store", () => {
    handleGitEnvelope("commit.start", { feature_id: 7 });
    handleGitEnvelope("commit.output", { feature_id: 7, text: "pre-commit\n" });
    handleGitEnvelope("commit.output", { feature_id: 7, line: "created commit" });
    handleGitEnvelope("commit.complete", { feature_id: 7 });

    const state = useCommitOutputStore.getState();
    expect(selectCommitOutput(7)(state)).toBe("pre-commit\ncreated commit\n");
    expect(selectCommitRunning(7)(state)).toBe(false);
  });

  it("routes push lifecycle envelopes into the push output store", () => {
    handleGitEnvelope("push.start", { feature_id: 7 });
    handleGitEnvelope("push.output", { feature_id: 7, text: "Counting objects\n" });
    handleGitEnvelope("push.output", { feature_id: 7, line: "remote: ok" });
    handleGitEnvelope("push.complete", { feature_id: 7 });

    const state = usePushOutputStore.getState();
    expect(selectPushOutput(7)(state)).toBe("Counting objects\nremote: ok\n");
    expect(selectPushRunning(7)(state)).toBe(false);
  });

  it("ignores malformed commit and push lifecycle payloads", () => {
    handleGitEnvelope("commit.start", { feature_id: "7" });
    handleGitEnvelope("commit.output", { feature_id: 7, text: 42 });
    handleGitEnvelope("commit.complete", { feature_id: null });
    handleGitEnvelope("push.start", { feature_id: "7" });
    handleGitEnvelope("push.output", { feature_id: 7, text: 42 });
    handleGitEnvelope("push.complete", { feature_id: null });

    expect(useCommitOutputStore.getState().byFeature).toEqual({});
    expect(useCommitOutputStore.getState().runningByFeature).toEqual({});
    expect(usePushOutputStore.getState().byFeature).toEqual({});
    expect(usePushOutputStore.getState().runningByFeature).toEqual({});
  });
});
