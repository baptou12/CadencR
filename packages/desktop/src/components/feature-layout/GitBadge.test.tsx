import { describe, expect, it } from "vitest";
import { pickIndicator } from "./GitBadge";

/**
 * State-machine tests for the badge's three-way priority. The visual is
 * intentionally minimal (one glyph + one number), so the readability of
 * "what's the next action?" depends entirely on this function picking
 * the right state. Every transition that matters in the user-facing
 * description gets a case.
 */
describe("pickIndicator", () => {
  it("returns null when the tree is clean and everything is merged", () => {
    expect(
      pickIndicator({
        uncommitted: 0,
        aheadOfRemote: 0,
        aheadOfTarget: 0,
        targetBranch: "origin/main",
      }),
    ).toBeNull();
  });

  it("surfaces uncommitted files first (amber `●N`)", () => {
    const ind = pickIndicator({
      uncommitted: 3,
      // Even with un-pushed commits and un-merged commits, the user
      // can't act on those until they commit the working tree.
      aheadOfRemote: 5,
      aheadOfTarget: 7,
      targetBranch: "origin/main",
    });
    expect(ind?.glyph).toBe("●");
    expect(ind?.count).toBe(3);
    expect(ind?.colorClass).toBe("text-amber-500");
    expect(ind?.tooltip).toBe("3 uncommitted files");
  });

  it("uses singular grammar for one uncommitted file", () => {
    expect(
      pickIndicator({
        uncommitted: 1,
        aheadOfRemote: 0,
        aheadOfTarget: 0,
        targetBranch: null,
      })?.tooltip,
    ).toBe("1 uncommitted file");
  });

  it("falls through to `ahead_of_remote` when the tree is clean (orange `↑N`)", () => {
    const ind = pickIndicator({
      uncommitted: 0,
      aheadOfRemote: 2,
      aheadOfTarget: 4,
      targetBranch: "origin/main",
    });
    expect(ind?.glyph).toBe("↑");
    expect(ind?.count).toBe(2);
    // Orange = "next action is push" — distinct from blue (ready for PR).
    expect(ind?.colorClass).toBe("text-orange-400");
    expect(ind?.tooltip).toBe("2 commits not pushed yet");
  });

  it("falls through to `ahead_of_target` only after everything is pushed (blue `↑N`)", () => {
    const ind = pickIndicator({
      uncommitted: 0,
      aheadOfRemote: 0,
      aheadOfTarget: 1,
      targetBranch: "origin/main",
    });
    expect(ind?.glyph).toBe("↑");
    expect(ind?.count).toBe(1);
    expect(ind?.colorClass).toBe("text-blue-400");
    // Tooltip names the target so the user can immediately tell which
    // branch this is "ahead of" — solves the original confusion where
    // `↑1` after a push was ambiguous.
    expect(ind?.tooltip).toBe("1 commit pushed, ahead of origin/main — ready to open a PR");
  });

  it("falls back to a generic 'ahead of target' phrasing when target is unknown", () => {
    // Edge case: the snapshot hasn't resolved a target_branch yet (e.g.
    // origin/HEAD missing, no fallback found). The badge still renders
    // a useful tooltip rather than a blank or broken string.
    const ind = pickIndicator({
      uncommitted: 0,
      aheadOfRemote: 0,
      aheadOfTarget: 2,
      targetBranch: null,
    });
    expect(ind?.tooltip).toBe("2 commits pushed, ahead of target");
  });
});
