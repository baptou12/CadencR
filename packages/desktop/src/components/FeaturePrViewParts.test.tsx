import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { PrStatusSnapshot } from "@/api/generated";
import { ChecksPanel } from "./FeaturePrViewParts";

function snapshot(): PrStatusSnapshot {
  return {
    setup_required: false,
    feature_id: 3,
    fetched_at: 1,
    error: null,
    ci: {
      state: "passing",
      checks: [{ name: "build", state: "passing", url: null }],
    },
    pr: {
      author: { username: "reviewer" },
      body_markdown: "",
      head_sha: "abc",
      number: 7,
      pr_label: "Pull request",
      review_state: "approved",
      source_branch: "feature/x",
      state: "open",
      target_branch: "main",
      title: "Add a thing",
      updated_at: "2026-07-24T00:00:00Z",
      url: "https://example.test/pr/7",
    },
  };
}

function checksToggle(): HTMLElement {
  return screen.getByRole("button", { name: /Checks/ });
}

describe("ChecksPanel", () => {
  it("stays expanded while the pane sits at the top", () => {
    render(<ChecksPanel status={snapshot()} collapsedByScroll={false} />);

    expect(checksToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("folds itself away once the pane is scrolled off the top", () => {
    const { rerender } = render(<ChecksPanel status={snapshot()} collapsedByScroll={false} />);

    rerender(<ChecksPanel status={snapshot()} collapsedByScroll />);

    expect(checksToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("unfolds again when the pane returns to the top", () => {
    const { rerender } = render(<ChecksPanel status={snapshot()} collapsedByScroll />);

    rerender(<ChecksPanel status={snapshot()} collapsedByScroll={false} />);

    expect(checksToggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("lets a manual expand win while scrolled away, then yields on the next scroll", () => {
    const { rerender } = render(<ChecksPanel status={snapshot()} collapsedByScroll />);

    fireEvent.click(checksToggle());
    expect(checksToggle()).toHaveAttribute("aria-expanded", "true");

    // Back to the top, then away again: the automatic behavior takes over
    // rather than replaying the override forever.
    rerender(<ChecksPanel status={snapshot()} collapsedByScroll={false} />);
    rerender(<ChecksPanel status={snapshot()} collapsedByScroll />);

    expect(checksToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("honors a manual collapse at the top", () => {
    render(<ChecksPanel status={snapshot()} collapsedByScroll={false} />);

    fireEvent.click(checksToggle());

    expect(checksToggle()).toHaveAttribute("aria-expanded", "false");
  });
});
