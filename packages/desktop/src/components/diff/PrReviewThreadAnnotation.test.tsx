import { fireEvent, render, screen } from "@/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { CommentThread } from "@/api/generated";
import { PrReviewThreadAnnotation } from "./PrReviewThreadAnnotation";

const THREAD: CommentThread = {
  id: "thread-1",
  resolved: false,
  outdated: false,
  file: "src/app.ts",
  line: 12,
  side: "new",
  comments: [
    {
      author: { username: "alice", display_name: "Alice", avatar_url: null },
      body_markdown: "First review message.",
      created_at: "2026-07-20T09:00:00Z",
      url: "https://github.example/org/repo/pull/7#discussion_r1",
    },
    {
      author: { username: "bob", display_name: "Bob", avatar_url: null },
      body_markdown: "Follow-up review message.",
      created_at: "2026-07-20T10:00:00Z",
      url: null,
    },
  ],
};

describe("PrReviewThreadAnnotation", () => {
  it("selects the same thread directly from its diff annotation", () => {
    const onThreadSelectedChange = vi.fn();
    const { container, rerender } = render(
      <PrReviewThreadAnnotation
        threads={[THREAD]}
        selectedThreadIds={new Set()}
        onThreadSelectedChange={onThreadSelectedChange}
      />,
    );

    fireEvent.click(screen.getByText("Review thread"));

    expect(onThreadSelectedChange).toHaveBeenCalledWith("thread-1", true);
    rerender(
      <PrReviewThreadAnnotation
        threads={[THREAD]}
        selectedThreadIds={new Set(["thread-1"])}
        onThreadSelectedChange={onThreadSelectedChange}
      />,
    );
    expect(container.querySelector('[data-review-thread-id="thread-1"]')).toHaveAttribute(
      "data-selected",
      "true",
    );
  });

  it("collapses a long conversation while retaining its first actionable message", () => {
    render(<PrReviewThreadAnnotation threads={[THREAD]} />);

    expect(screen.getByText("First review message.")).toBeVisible();
    expect(screen.queryByText("Follow-up review message.")).toBeNull();
    expect(screen.getByRole("button", { name: "Show full thread · 2 messages" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Reply on github.example" })).toBeVisible();
  });

  it("retains the outdated status when thread selection is unavailable", () => {
    render(<PrReviewThreadAnnotation threads={[{ ...THREAD, outdated: true }]} />);

    expect(screen.getByText("outdated")).toBeVisible();
  });

  it("expands on demand and exposes every reviewer response", () => {
    render(<PrReviewThreadAnnotation threads={[THREAD]} />);

    fireEvent.click(screen.getByRole("button", { name: "Show full thread · 2 messages" }));

    expect(screen.getByText("Follow-up review message.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Collapse thread" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("auto-expands and marks a keyboard-navigated target", () => {
    const { container } = render(
      <PrReviewThreadAnnotation threads={[THREAD]} activeThreadId="thread-1" />,
    );

    expect(container.querySelector('[data-review-thread-id="thread-1"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("Follow-up review message.")).toBeVisible();
  });
});
