import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PrStatusSnapshot } from "@/api/generated";
import { prAttentionSignal, usePrAttention } from "./usePrAttention";

function snapshot(overrides: Partial<PrStatusSnapshot> = {}): PrStatusSnapshot {
  return {
    feature_id: 12,
    fetched_at: 100,
    auth_required: false,
    error: null,
    pr: {
      number: 42,
      title: "Forge integration",
      body_markdown: "",
      state: "open",
      url: "https://example.test/pr/42",
      source_branch: "feature/forge",
      target_branch: "main",
      head_sha: "abc",
      review_state: "pending",
      author: { username: "octo" },
      updated_at: "2026-07-24T04:00:00Z",
      pr_label: "PR",
    },
    ci: {
      state: "running",
      checks: [{ name: "test", state: "running", url: null }],
    },
    ...overrides,
  };
}

describe("usePrAttention", () => {
  it("badges semantic changes outside the PR view and acknowledges them when opened", () => {
    const initial = snapshot();
    const { result, rerender } = renderHook(
      ({ status, active }) => usePrAttention(status, active),
      { initialProps: { status: initial, active: false } },
    );

    expect(result.current).toBe(false);
    rerender({
      status: snapshot({
        fetched_at: 200,
        ci: { state: "passing", checks: [{ name: "test", state: "passing", url: null }] },
      }),
      active: false,
    });
    expect(result.current).toBe(true);

    act(() => rerender({ status: snapshot({ fetched_at: 200 }), active: true }));
    expect(result.current).toBe(false);
  });

  it("ignores fetch timestamps but catches proposal discussion updates", () => {
    const initial = snapshot();
    expect(prAttentionSignal(snapshot({ fetched_at: 999 }))).toBe(prAttentionSignal(initial));

    const { result, rerender } = renderHook(
      ({ status, active }) => usePrAttention(status, active),
      { initialProps: { status: initial, active: false } },
    );
    rerender({ status: snapshot({ fetched_at: 999 }), active: false });
    expect(result.current).toBe(false);

    rerender({
      status: snapshot({
        pr: { ...initial.pr!, updated_at: "2026-07-24T05:00:00Z" },
      }),
      active: false,
    });
    expect(result.current).toBe(true);
  });
});
