import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { ReviewThreadSummary } from "@/lib/pr-review-threads";
import { GitReviewStatus } from "./GitReviewStatus";

const EMPTY_SUMMARY: ReviewThreadSummary = {
  total: 0,
  anchored: 0,
  general: 0,
  outdated: 0,
  automated: 0,
  byFile: new Map(),
};

function renderStatus(overrides: Partial<React.ComponentProps<typeof GitReviewStatus>> = {}) {
  const props: React.ComponentProps<typeof GitReviewStatus> = {
    isLoading: false,
    isRefreshing: false,
    errorMessage: undefined,
    summary: EMPTY_SUMMARY,
    activePosition: 0,
    targetCount: 0,
    onRetry: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  return { ...render(<GitReviewStatus {...props} />), props };
}

describe("GitReviewStatus", () => {
  it("says the review comments failed rather than rendering a clean diff", () => {
    // A silent failure here reads as "nothing left to address" — the most
    // expensive wrong conclusion this feature can produce.
    const onRetry = vi.fn();
    renderStatus({ errorMessage: "Forge rejected the token", onRetry });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Review feedback unavailable");
    expect(alert).toHaveTextContent("Forge rejected the token");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Git settings" })).toBeVisible();
  });

  it("acknowledges the wait while the forge is still answering", () => {
    renderStatus({ isLoading: true });

    expect(screen.getByRole("status")).toHaveTextContent("Loading review feedback…");
  });

  it("reports the error even mid-refetch, since the stale failure still applies", () => {
    renderStatus({ isLoading: true, isRefreshing: true, errorMessage: "Rate limited" });

    expect(screen.getByRole("alert")).toHaveTextContent("Rate limited");
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("keeps a trustworthy clean-state summary visible", () => {
    renderStatus();

    expect(screen.getByRole("status")).toHaveTextContent("No open review threads");
  });

  it("summarizes thread categories and navigates anchored feedback", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    renderStatus({
      summary: {
        total: 5,
        anchored: 2,
        general: 1,
        outdated: 1,
        automated: 1,
        byFile: new Map([["src/app.ts", 2]]),
      },
      activePosition: 1,
      targetCount: 2,
      onPrevious,
      onNext,
    });

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("5 open review threads");
    expect(status).toHaveTextContent("2 inline");
    expect(status).toHaveTextContent("1 general");
    expect(status).toHaveTextContent("1 outdated");
    expect(status).toHaveTextContent("1 automated");
    expect(status).toHaveTextContent("1 / 2");
    screen.getByRole("button", { name: "Previous unresolved review thread" }).click();
    screen.getByRole("button", { name: "Next unresolved review thread" }).click();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
