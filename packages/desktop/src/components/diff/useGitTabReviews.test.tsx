import { act, renderHook, waitFor } from "@/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentThread, PrSummary } from "@/api/generated";
import type { PrReviewThreads } from "@/hooks/usePrReviewThreads";
import type { GitViewMode } from "./GitTabToggle";
import { useGitTabReviews } from "./useGitTabReviews";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  unresolved: [] as CommentThread[],
}));

function reviewThreads(): PrReviewThreads {
  return {
    threads: mocks.unresolved,
    unresolved: mocks.unresolved,
    unresolvedCount: mocks.unresolved.length,
    unresolvedLinesByFile: new Map(),
    navigationTargets: [],
    summary: {
      total: mocks.unresolved.length,
      anchored: 0,
      general: mocks.unresolved.length,
      outdated: 0,
      automated: 0,
      byFile: new Map(),
    },
    isLoading: false,
    isRefreshing: false,
    errorMessage: undefined,
    retry: vi.fn(),
  };
}

vi.mock("@/hooks/useSendUnresolvedPrComments", () => ({
  useSendUnresolvedPrComments: () => ({
    send: mocks.send,
    disabled: false,
    shouldRender: true,
  }),
}));

function thread(id: string): CommentThread {
  return {
    id,
    resolved: false,
    outdated: false,
    file: `src/${id}.ts`,
    line: 10,
    side: "new",
    comments: [
      {
        author: { username: "alice", display_name: null, avatar_url: null },
        body_markdown: `Feedback for ${id}`,
        created_at: "2026-07-20T09:00:00Z",
        url: null,
      },
    ],
  };
}

const PR: PrSummary = {
  number: 4,
  title: "Review UX",
  body_markdown: "",
  state: "open",
  url: "https://github.example/org/repo/pull/4",
  source_branch: "feature/review",
  target_branch: "main",
  head_sha: "a".repeat(40),
  review_state: "changes_requested",
  author: { username: "alice", display_name: null, avatar_url: null },
  updated_at: "2026-07-20T09:00:00Z",
  pr_label: "Pull request",
};

describe("useGitTabReviews selection", () => {
  beforeEach(() => {
    mocks.send.mockClear();
    mocks.unresolved = [thread("one"), thread("two")];
  });

  it("shares selection across PR and diff surfaces, then clears it after sending", () => {
    const { result, rerender } = renderHook(
      ({ viewMode }) => useGitTabReviews(viewMode, PR, vi.fn(), reviewThreads()),
      { initialProps: { viewMode: "pr" as GitViewMode } },
    );

    expect(result.current.selectedCount).toBe(0);
    expect(result.current.sendDisabled).toBe(true);

    act(() => result.current.setThreadSelected("two", true));
    expect(result.current.selectedThreadIds.has("two")).toBe(true);

    rerender({ viewMode: "vs-target" });
    expect(result.current.selectedThreadIds.has("two")).toBe(true);

    act(() => result.current.sendSelected());
    expect(mocks.send).toHaveBeenCalledWith([expect.objectContaining({ id: "two" })]);
    expect(result.current.selectedCount).toBe(0);
  });

  it("drops selections that are no longer unresolved", async () => {
    const { result, rerender } = renderHook(() =>
      useGitTabReviews("pr", PR, vi.fn(), reviewThreads()),
    );

    act(() => result.current.setThreadSelected("two", true));
    mocks.unresolved = [mocks.unresolved[0]!];
    rerender();

    await waitFor(() => expect(result.current.selectedCount).toBe(0));
  });

  it("preserves selection identity for no-op updates", () => {
    const { result } = renderHook(() => useGitTabReviews("pr", PR, vi.fn(), reviewThreads()));

    const emptySelection = result.current.selectedThreadIds;
    act(() => result.current.setThreadSelected("missing", true));
    expect(result.current.selectedThreadIds).toBe(emptySelection);

    act(() => result.current.setThreadSelected("one", true));
    const selected = result.current.selectedThreadIds;
    act(() => result.current.setThreadSelected("one", true));
    expect(result.current.selectedThreadIds).toBe(selected);
  });
});
