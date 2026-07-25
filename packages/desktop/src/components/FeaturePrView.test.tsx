import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { PrStatusSnapshot } from "@/api/generated";
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
