import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import type { CiCheck, CiState, PrStatusSnapshot, ReviewState } from "@/api/generated";
import { PrStatusBand, reviewStateLabel } from "./PrStatusBand";

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

function snapshot(
  ci: { state: CiState; checks: CiCheck[] } | null,
  reviewState: ReviewState = "none",
): PrStatusSnapshot {
  return {
    setup_required: false,
    feature_id: 3,
    fetched_at: 1,
    error: null,
    ci,
    pr: {
      author: { username: "reviewer", display_name: "Rae Viewer" },
      body_markdown: "",
      head_sha: "abc",
      number: 128,
      pr_label: "Pull request",
      review_state: reviewState,
      source_branch: "feature/x",
      state: "open",
      target_branch: "main",
      title: "Add a thing",
      updated_at: "2026-07-24T00:00:00Z",
      url: "https://example.test/pr/128",
    },
  };
}

function band(props: Partial<Parameters<typeof PrStatusBand>[0]> = {}) {
  return (
    <PrStatusBand
      status={snapshot({ state: "passing", checks: [{ name: "build", state: "passing" }] })}
      unresolvedCount={0}
      unresolvedFiltered={false}
      onToggleUnresolved={vi.fn()}
      onRefresh={vi.fn()}
      isRefreshing={false}
      {...props}
    />
  );
}

/** The checks fact is the one control in the band that discloses a list. */
function checksFact(): HTMLElement {
  const fact = screen.getAllByRole("button").find((button) => button.hasAttribute("aria-expanded"));
  if (!fact) throw new Error("no disclosure fact rendered");
  return fact;
}

describe("PrStatusBand", () => {
  it("answers 'is it green?' without opening anything", () => {
    render(band());

    expect(checksFact()).toHaveTextContent("1 check passing");
  });

  it("keeps a passing run folded — the summary is already the answer", () => {
    render(band());

    expect(checksFact()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a failing run, because the summary never names the broken job", () => {
    render(
      band({
        status: snapshot({
          state: "failing",
          checks: [
            { name: "build", state: "passing" },
            { name: "e2e", state: "failing" },
          ],
        }),
      }),
    );

    expect(checksFact()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("e2e")).toBeVisible();
  });

  it("lets the developer overrule that default in either direction", () => {
    render(
      band({ status: snapshot({ state: "failing", checks: [{ name: "e2e", state: "failing" }] }) }),
    );

    fireEvent.click(checksFact());

    expect(checksFact()).toHaveAttribute("aria-expanded", "false");
  });

  it("routes the unresolved count to the filter it describes", () => {
    const onToggleUnresolved = vi.fn();
    render(band({ unresolvedCount: 3, onToggleUnresolved }));

    fireEvent.click(screen.getByRole("button", { name: /3 unresolved/ }));

    expect(onToggleUnresolved).toHaveBeenCalledOnce();
  });

  it("shows no checks fact at all when the forge reported none", () => {
    render(band({ status: snapshot({ state: "none", checks: [] }) }));

    expect(
      screen.getAllByRole("button").some((button) => button.hasAttribute("aria-expanded")),
    ).toBe(false);
  });

  it("counts the jobs in the state it names, not the whole run", () => {
    render(
      band({
        status: snapshot({
          state: "failing",
          checks: [
            { name: "lint", state: "passing" },
            { name: "build", state: "passing" },
            { name: "e2e", state: "failing" },
          ],
        }),
      }),
    );

    // "3 checks failing" for one broken job is the kind of copy that teaches
    // people to stop trusting the summary.
    expect(checksFact()).toHaveTextContent("1 of 3 failing");
  });

  it("says so plainly when nothing at all is reported", () => {
    render(band({ status: snapshot(null) }));

    expect(
      screen.getByText("Nothing reported yet — no checks, no reviews, no open threads."),
    ).toBeVisible();
  });

  it("states an actionable review verdict alongside the checks", () => {
    render(band({ status: snapshot({ state: "passing", checks: [] }, "changes_requested") }));

    expect(screen.getByText("changes requested")).toBeVisible();
  });

  it("refreshes from the forge on demand", () => {
    const onRefresh = vi.fn();
    render(band({ onRefresh }));

    fireEvent.click(screen.getByRole("button", { name: "Refresh from the forge" }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
