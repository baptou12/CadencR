import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { PrStatusSnapshot } from "@/api/generated";
import { FeaturePrChip, prIndicatorTone } from "./PrStatusIndicators";

function snapshot(
  overrides: Partial<PrStatusSnapshot> = {},
  prOverrides: Partial<NonNullable<PrStatusSnapshot["pr"]>> = {},
): PrStatusSnapshot {
  return {
    auth_required: false,
    feature_id: 20,
    fetched_at: 1,
    error: null,
    ci: { state: "passing", checks: [] },
    pr: {
      author: { username: "reviewer" },
      body_markdown: "",
      head_sha: "abc",
      number: 20,
      pr_label: "PR",
      review_state: "approved",
      source_branch: "feature",
      state: "open",
      target_branch: "main",
      title: "Status colors",
      updated_at: "2026-07-24T00:00:00Z",
      url: "https://example.test/pr/20",
      ...prOverrides,
    },
    ...overrides,
  };
}

describe("prIndicatorTone", () => {
  it("uses green only for merged pull requests", () => {
    expect(prIndicatorTone(snapshot({}, { state: "merged" }))).toBe("merged");
  });

  it("uses orange for review and merge blockers even when checks fail", () => {
    expect(
      prIndicatorTone(
        snapshot({ ci: { state: "failing", checks: [] } }, { review_state: "changes_requested" }),
      ),
    ).toBe("blocked");
    expect(prIndicatorTone(snapshot({}, { review_state: "pending" }))).toBe("blocked");
    expect(prIndicatorTone(snapshot({}, { state: "draft" }))).toBe("blocked");
    expect(prIndicatorTone(snapshot({ ci: { state: "running", checks: [] } }))).toBe("blocked");
  });

  it("uses red for failed checks and blue when no blocker is reported", () => {
    expect(prIndicatorTone(snapshot({ ci: { state: "failing", checks: [] } }))).toBe("danger");
    expect(prIndicatorTone(snapshot())).toBe("ready");
    expect(prIndicatorTone(snapshot({ ci: { state: "none", checks: [] } }))).toBe("ready");
  });
});

describe("FeaturePrChip", () => {
  it("renders a right-side viewport-safe tooltip for the sidebar chip", () => {
    render(<FeaturePrChip snapshot={snapshot()} />);
    const chip = screen.getByLabelText("PR 20 · approved · checks passing");
    fireEvent.mouseEnter(chip.parentElement!);
    const tip = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!;
    const positioner = tip.parentElement!;
    expect(tip).toHaveTextContent("PR 20 · approved · checks passing");
    expect(positioner.style.position).toBe("fixed");
    expect(tip.className).toContain("max-w-[calc(100vw-1rem)]");
    expect(positioner.parentElement).toBe(document.body);
  });
});
