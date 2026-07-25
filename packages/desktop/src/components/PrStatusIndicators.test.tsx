import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { PrStatusSnapshot } from "@/api/generated";
import { FeaturePrIndicator, prIndicatorTone } from "./PrStatusIndicators";

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
      pr_label: "Pull request",
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

  it("uses orange for review and merge blockers", () => {
    expect(prIndicatorTone(snapshot({}, { review_state: "changes_requested" }))).toBe("blocked");
    expect(prIndicatorTone(snapshot({}, { review_state: "pending" }))).toBe("blocked");
    expect(prIndicatorTone(snapshot({}, { state: "draft" }))).toBe("blocked");
    expect(prIndicatorTone(snapshot({ ci: { state: "running", checks: [] } }))).toBe("blocked");
  });

  it("uses red for failed checks and blue when no blocker is reported", () => {
    expect(prIndicatorTone(snapshot({ ci: { state: "failing", checks: [] } }))).toBe("danger");
    expect(prIndicatorTone(snapshot())).toBe("ready");
    expect(prIndicatorTone(snapshot({ ci: { state: "none", checks: [] } }))).toBe("ready");
  });

  it("lets a failing check outrank a review blocker, since the chip is the only slot", () => {
    // Awaiting review is the most common state to be in while checks fail; if
    // orange won, red CI would be invisible in the sidebar.
    expect(
      prIndicatorTone(
        snapshot({ ci: { state: "failing", checks: [] } }, { review_state: "pending" }),
      ),
    ).toBe("danger");
    expect(
      prIndicatorTone(
        snapshot({ ci: { state: "failing", checks: [] } }, { review_state: "changes_requested" }),
      ),
    ).toBe("danger");
    expect(prIndicatorTone(snapshot({ error: "Bad credentials" }))).toBe("danger");
  });
});

describe("FeaturePrIndicator", () => {
  it("renders a right-side viewport-safe tooltip for the sidebar chip", () => {
    render(<FeaturePrIndicator snapshot={snapshot()} />);
    const chip = screen.getByLabelText("Pull request #20 · approved · checks passing");
    fireEvent.mouseEnter(chip.parentElement!);
    const tip = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!;
    const positioner = tip.parentElement!;
    expect(tip).toHaveTextContent("Pull request #20 · approved · checks passing");
    expect(positioner.style.position).toBe("fixed");
    expect(tip.className).toContain("max-w-[calc(100vw-1rem)]");
    expect(positioner.parentElement).toBe(document.body);
  });

  it("stays flat once the checks have settled", () => {
    render(<FeaturePrIndicator snapshot={snapshot()} />);

    expect(screen.getByLabelText(/^Pull request #20/).className).not.toContain(
      "pr-chip-checks-running",
    );
  });

  it("breathes only while checks are still running", () => {
    render(<FeaturePrIndicator snapshot={snapshot({ ci: { state: "running", checks: [] } })} />);

    expect(screen.getByLabelText(/^Pull request #20/).className).toContain(
      "pr-chip-checks-running",
    );
  });

  it("keeps a host error visible when no proposal was found", () => {
    render(<FeaturePrIndicator snapshot={snapshot({ pr: null, error: "Bad credentials" })} />);

    expect(screen.getByLabelText("Forge status error: Bad credentials")).toBeInTheDocument();
  });
});
