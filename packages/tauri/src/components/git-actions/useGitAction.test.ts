/**
 * Snapshot matrix for `deriveGitAction` — the pure core of the smart Git
 * action button. Each test names one row of the matrix.
 */
import { describe, expect, it } from "vitest";
import { deriveGitAction } from "./useGitAction";
import type { GitStatusSnapshot } from "@/api/generated";

function snapshot(overrides: Partial<GitStatusSnapshot> = {}): GitStatusSnapshot {
  return {
    feature_id: 1,
    current_branch: "feature/x",
    target_branch: "main",
    uncommitted_count: 0,
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0,
    ahead_of_remote: 0,
    behind_remote: 0,
    ahead_of_target: 0,
    has_remote: true,
    host: "GitHub",
    compare_url: "https://github.com/x/y/compare/main...feature/x",
    action_label: "Open PR",
    computed_at: 0,
    ...overrides,
  };
}

describe("deriveGitAction", () => {
  it("returns Loading state when no snapshot is available", () => {
    const state = deriveGitAction(undefined);
    expect(state.primary).toBeNull();
    expect(state.label).toBe("Loading…");
    expect(state.disabled.commit).toBe("Loading…");
    expect(state.disabled.push).toBe("Loading…");
    expect(state.disabled.pr).toBe("Loading…");
  });

  it("primary=commit when there are uncommitted changes", () => {
    const state = deriveGitAction(snapshot({ uncommitted_count: 3, untracked_count: 1 }));
    expect(state.primary).toBe("commit");
    expect(state.label).toBe("Commit");
    expect(state.disabled.commit).toBeNull();
    expect(state.disabled.push).toBe("Commit your changes first");
    expect(state.disabled.pr).toBe("Commit your changes first");
  });

  it("primary=push when clean but ahead of remote", () => {
    const state = deriveGitAction(snapshot({ ahead_of_remote: 2 }));
    expect(state.primary).toBe("push");
    expect(state.label).toBe("Push");
    expect(state.disabled.push).toBeNull();
    expect(state.disabled.commit).toBe("No uncommitted changes");
    expect(state.disabled.pr).toBe("Push your commits first");
  });

  it("primary=pr when clean, pushed, and ahead of target with provider compare URL", () => {
    const state = deriveGitAction(snapshot({ ahead_of_target: 4, action_label: "Open MR" }));
    expect(state.primary).toBe("pr");
    expect(state.label).toBe("Open MR");
    expect(state.disabled.pr).toBeNull();
  });

  it("primary=null on a fully clean tree with nothing to push or PR", () => {
    const state = deriveGitAction(snapshot());
    expect(state.primary).toBeNull();
    expect(state.disabled.commit).toBe("No uncommitted changes");
    expect(state.disabled.push).toBe("Nothing to push");
    expect(state.disabled.pr).toBe("Nothing to compare");
  });

  it("PR disabled with 'No remote configured' when has_remote=false", () => {
    const state = deriveGitAction(
      snapshot({ ahead_of_target: 1, has_remote: false, compare_url: null, host: null }),
    );
    expect(state.primary).toBeNull();
    expect(state.disabled.pr).toBe("No remote configured");
  });

  it("PR disabled with provider-unavailable reason for Other host without compare URL", () => {
    const state = deriveGitAction(
      snapshot({
        ahead_of_target: 1,
        host: "Other",
        compare_url: null,
        action_label: "Open compare",
      }),
    );
    expect(state.primary).toBeNull();
    expect(state.disabled.pr).toBe("Compare URL not available for this remote");
    expect(state.compareLabel).toBe("Open compare");
  });

  it("PR enabled for Other host when backend supplied a compare URL", () => {
    const state = deriveGitAction(
      snapshot({
        ahead_of_target: 1,
        host: "Other",
        compare_url: "https://example.com/compare",
        action_label: "Open compare",
      }),
    );
    expect(state.primary).toBe("pr");
    expect(state.label).toBe("Open compare");
  });

  it("commit wins over push when both are technically actionable (commit has higher priority)", () => {
    const state = deriveGitAction(snapshot({ uncommitted_count: 1, ahead_of_remote: 2 }));
    expect(state.primary).toBe("commit");
  });

  it("falls back to 'Open PR' for compareLabel when action_label is missing", () => {
    const state = deriveGitAction(
      snapshot({
        ahead_of_target: 1,
        action_label: null,
        host: null,
        compare_url: "https://example.com/compare",
      }),
    );
    // compareLabel is the per-action label rendered in the popover, even when
    // backend didn't ship action_label — the frontend is provider-neutral and
    // uses a generic fallback.
    expect(state.compareLabel).toBe("Open PR");
    expect(state.primary).toBe("pr");
    expect(state.label).toBe("Open PR");
  });

  it("PR disabled whenever compare_url is missing, regardless of host", () => {
    // Provider-neutral check: the frontend never reads `host` to decide
    // availability — `compare_url == null` is the single source of truth.
    const state = deriveGitAction(
      snapshot({ ahead_of_target: 1, host: null, compare_url: null, action_label: null }),
    );
    expect(state.primary).toBeNull();
    expect(state.disabled.pr).toBe("Compare URL not available for this remote");
  });
});
