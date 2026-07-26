import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { CommentThread, PrStatusSnapshot } from "@/api/generated";
import type { PrReviewThreads } from "@/hooks/usePrReviewThreads";
import { usePrStatusStore } from "@/stores/usePrStatusStore";
import { FeaturePrView, reviewStateLabel } from "./FeaturePrView";

describe("reviewStateLabel", () => {
  it("hides the provider's absence-of-review sentinel", () => {
    expect(reviewStateLabel("none")).toBeNull();
  });

  it("uses user-facing labels for actionable review states", () => {
    expect(reviewStateLabel("approved")).toBe("approved");
    expect(reviewStateLabel("changes_requested")).toBe("changes requested");
    expect(reviewStateLabel("pending")).toBe("review pending");
  });
});

function snapshot(): PrStatusSnapshot {
  return {
    auth_required: false,
    feature_id: 42,
    fetched_at: 1,
    error: null,
    ci: { state: "passing", checks: [] },
    pr: {
      author: { username: "reviewer" },
      body_markdown: "",
      head_sha: "abc",
      number: 42,
      pr_label: "Pull request",
      review_state: "approved",
      source_branch: "feature/x",
      state: "open",
      target_branch: "main",
      title: "Pinned band",
      updated_at: "2026-07-24T00:00:00Z",
      url: "https://example.test/pr/42",
    },
  };
}

const REVIEWS: PrReviewThreads = {
  threads: [],
  unresolved: [],
  unresolvedCount: 0,
  unresolvedLinesByFile: new Map(),
  navigationTargets: [],
  summary: {
    total: 0,
    anchored: 0,
    general: 0,
    outdated: 0,
    automated: 0,
    byFile: new Map(),
  },
  isLoading: false,
  isRefreshing: false,
  errorMessage: undefined,
  retry: () => undefined,
};

describe("FeaturePrView pinned band", () => {
  beforeEach(() => {
    usePrStatusStore.setState({ byFeature: {}, latestFetchedAtByFeature: {} });
    usePrStatusStore.getState().setStatus(snapshot());
  });

  it("forwards a wheel gesture over the pinned band to the thread scroller", () => {
    render(<FeaturePrView featureId={42} reviews={REVIEWS} />);
    const band = screen.getByRole("heading", { name: "Pinned band" }).closest("div.shrink-0")!;
    const scroller = band.nextElementSibling as HTMLElement;

    fireEvent.wheel(band, { deltaY: 180 });

    expect(scroller.scrollTop).toBe(180);
  });

  it("scales a line-mode wheel delta, which would otherwise scroll ~3px", () => {
    render(<FeaturePrView featureId={42} reviews={REVIEWS} />);
    const band = screen.getByRole("heading", { name: "Pinned band" }).closest("div.shrink-0")!;
    const scroller = band.nextElementSibling as HTMLElement;

    fireEvent.wheel(band, { deltaY: 3, deltaMode: 1 });

    expect(scroller.scrollTop).toBe(48);
  });
});

function unresolvedThread(id: string): CommentThread {
  return {
    id,
    resolved: false,
    outdated: false,
    file: `src/${id}.ts`,
    line: 4,
    side: "new",
    comments: [
      {
        author: { username: "reviewer", display_name: null, avatar_url: null },
        body_markdown: `Please fix ${id}`,
        created_at: "2026-07-24T00:00:00Z",
        url: null,
      },
    ],
  };
}

function reviewsWith(threads: CommentThread[]): PrReviewThreads {
  return {
    ...REVIEWS,
    threads,
    unresolved: threads,
    unresolvedCount: threads.length,
    summary: { ...REVIEWS.summary, total: threads.length, anchored: threads.length },
  };
}

describe("FeaturePrView select-all", () => {
  const threads = [unresolvedThread("one"), unresolvedThread("two")];

  beforeEach(() => {
    usePrStatusStore.setState({ byFeature: {}, latestFetchedAtByFeature: {} });
    usePrStatusStore.getState().setStatus(snapshot());
  });

  function renderWith(selected: string[], onAll = vi.fn()) {
    render(
      <FeaturePrView
        featureId={42}
        reviews={reviewsWith(threads)}
        selectedThreadIds={new Set(selected)}
        onThreadSelectedChange={vi.fn()}
        onAllThreadsSelectedChange={onAll}
      />,
    );
    return screen.getByRole("checkbox", { name: /send all 2 unresolved threads to the agent/i });
  }

  it("takes every unresolved thread from an empty selection", () => {
    const onAll = vi.fn();
    fireEvent.click(renderWith([], onAll));
    expect(onAll).toHaveBeenCalledWith(true);
  });

  it("reads as partial while some threads are checked", () => {
    expect(renderWith(["one"])).toHaveAttribute("data-state", "indeterminate");
    expect(screen.getByText("1 of 2 picked — send from the bar below.")).toBeVisible();
  });

  it("clears the selection when every thread is already checked", () => {
    const onAll = vi.fn();
    const checkbox = renderWith(["one", "two"], onAll);

    expect(checkbox).toHaveAttribute("data-state", "checked");
    fireEvent.click(checkbox);
    expect(onAll).toHaveBeenCalledWith(false);
  });

  it("stays out of the way when nothing can be selected", () => {
    render(
      <FeaturePrView
        featureId={42}
        reviews={REVIEWS}
        onThreadSelectedChange={vi.fn()}
        onAllThreadsSelectedChange={vi.fn()}
      />,
    );
    // No name filter: an empty unresolved list must render no checkbox at all,
    // and matching on the old label would have passed for the wrong reason.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps the checkbox mounted across a selection change, so focus survives", () => {
    // Virtuoso's Header used to be rebuilt whenever the selection changed. A
    // fresh function identity is a new component type to React, so the whole
    // header subtree remounted and the checkbox lost focus on every tick —
    // ticking two boxes in a row from the keyboard was impossible.
    const name = /send all 2 unresolved threads to the agent/i;
    const { rerender } = render(
      <FeaturePrView
        featureId={42}
        reviews={reviewsWith(threads)}
        selectedThreadIds={new Set<string>()}
        onThreadSelectedChange={vi.fn()}
        onAllThreadsSelectedChange={vi.fn()}
      />,
    );
    const before = screen.getByRole("checkbox", { name });
    before.focus();
    expect(document.activeElement).toBe(before);

    rerender(
      <FeaturePrView
        featureId={42}
        reviews={reviewsWith(threads)}
        selectedThreadIds={new Set(["one"])}
        onThreadSelectedChange={vi.fn()}
        onAllThreadsSelectedChange={vi.fn()}
      />,
    );

    const after = screen.getByRole("checkbox", { name });
    expect(after).toBe(before);
    expect(document.activeElement).toBe(after);
    expect(after).toHaveAttribute("data-state", "indeterminate");
  });
});
