import { fireEvent, render, screen } from "@/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { CommentThread } from "@/api/generated";
import { CommentsHeader, PrCommentThread } from "./FeaturePrComments";

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: "thread-1",
    resolved: false,
    outdated: false,
    file: "src/app.ts",
    line: 12,
    side: "new",
    comments: [
      {
        author: { username: "alice", display_name: "Alice", avatar_url: null },
        body_markdown: "Please handle the empty state.",
        created_at: "2026-07-20T09:00:00Z",
        url: "https://gitlab.example/group/project/-/merge_requests/8#note_2",
      },
    ],
    ...overrides,
  };
}

describe("PrCommentThread actions", () => {
  it("selects an open thread directly from the PR timeline", () => {
    const onSelectedChange = vi.fn();
    const value = thread();
    const { container, rerender } = render(
      <PrCommentThread thread={value} selected={false} onSelectedChange={onSelectedChange} />,
    );

    fireEvent.click(screen.getByText("src/app.ts:12"));

    expect(onSelectedChange).toHaveBeenCalledWith(true);
    rerender(<PrCommentThread thread={value} selected onSelectedChange={onSelectedChange} />);
    expect(container.querySelector("article")).toHaveAttribute("data-selected", "true");
  });

  it("offers direct current-diff navigation and a provider-aware reply action", () => {
    const onViewThread = vi.fn();
    const value = thread();
    render(<PrCommentThread thread={value} onViewThread={onViewThread} />);

    fireEvent.click(screen.getByRole("button", { name: "View in diff" }));

    expect(onViewThread).toHaveBeenCalledWith(value);
    expect(screen.getByRole("button", { name: "Reply on gitlab.example" })).toBeVisible();
  });

  it("does not pretend outdated or resolved anchors can be found in the current diff", () => {
    const { rerender } = render(
      <PrCommentThread thread={thread({ outdated: true })} onViewThread={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "View in diff" })).toBeNull();

    rerender(<PrCommentThread thread={thread({ resolved: true })} onViewThread={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "View in diff" })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("CommentsHeader", () => {
  it("explains the select-then-send flow when review selection is available", () => {
    render(
      <CommentsHeader
        commentsLoading={false}
        commentsRefreshing={false}
        commentsError={undefined}
        onRetry={vi.fn()}
        commentCount={2}
        unresolvedCount={2}
        totalCount={2}
        filter="unresolved"
        onFilterChange={vi.fn()}
        selectionEnabled
        onAllSelectedChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /send all 2 unresolved threads to the agent/i }),
    ).toBeVisible();
    expect(screen.getByText(/Or tick individual threads/)).toBeVisible();
  });

  it("leaves the select-all control out when the caller cannot act on it", () => {
    render(
      <CommentsHeader
        commentsLoading={false}
        commentsRefreshing={false}
        commentsError={undefined}
        onRetry={vi.fn()}
        commentCount={2}
        unresolvedCount={2}
        totalCount={2}
        filter="unresolved"
        onFilterChange={vi.fn()}
        selectionEnabled
      />,
    );

    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
