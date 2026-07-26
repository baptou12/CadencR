import { beforeEach, describe, expect, it } from "vitest";
import type { PrStatusSnapshot } from "@/api/generated";
import { selectPrStatus, usePrStatusStore } from "./usePrStatusStore";

function snapshot(featureId: number, fetchedAt: number): PrStatusSnapshot {
  return {
    feature_id: featureId,
    fetched_at: fetchedAt,
    setup_required: false,
    pr: null,
    ci: null,
    error: null,
  };
}

beforeEach(() => usePrStatusStore.setState({ byFeature: {}, latestFetchedAtByFeature: {} }));

describe("usePrStatusStore", () => {
  it("hydrates multiple features and exposes narrow selectors", () => {
    usePrStatusStore.getState().hydrate([snapshot(1, 10), snapshot(2, 20)]);

    expect(selectPrStatus(1)(usePrStatusStore.getState())?.fetched_at).toBe(10);
    expect(selectPrStatus(2)(usePrStatusStore.getState())?.fetched_at).toBe(20);
  });

  it("rejects a stale HTTP or WebSocket snapshot", () => {
    usePrStatusStore.getState().setStatus(snapshot(1, 20));
    usePrStatusStore.getState().setStatus({ ...snapshot(1, 10), error: "stale" });

    expect(selectPrStatus(1)(usePrStatusStore.getState())).toEqual(snapshot(1, 20));
  });

  it("keeps the same reference for a newer semantically-identical snapshot", () => {
    usePrStatusStore.getState().setStatus(snapshot(1, 10));
    const existing = selectPrStatus(1)(usePrStatusStore.getState());

    usePrStatusStore.getState().hydrate([snapshot(1, 20)]);

    expect(selectPrStatus(1)(usePrStatusStore.getState())).toBe(existing);

    usePrStatusStore.getState().setStatus({ ...snapshot(1, 15), error: "delayed" });
    expect(selectPrStatus(1)(usePrStatusStore.getState())).toBe(existing);
  });

  it("stores a resolved thread count, the only field that moves on a green PR", () => {
    // The equality gate is the frontend mirror of the backend's `semantic_eq`.
    // It omitted `unresolved_threads`, so the last thread being resolved was
    // broadcast by the poller and then dropped here — the sidebar chip kept
    // claiming outstanding threads until something else about the PR changed.
    usePrStatusStore.getState().setStatus({ ...snapshot(1, 10), unresolved_threads: 2 });
    usePrStatusStore.getState().setStatus({ ...snapshot(1, 20), unresolved_threads: 0 });

    expect(selectPrStatus(1)(usePrStatusStore.getState())?.unresolved_threads).toBe(0);
  });

  it("distinguishes a forge that needs connecting from one that merely failed", () => {
    usePrStatusStore.getState().setStatus({ ...snapshot(1, 10), error: "nope" });
    usePrStatusStore
      .getState()
      .setStatus({ ...snapshot(1, 20), error: "nope", setup_required: true });

    expect(selectPrStatus(1)(usePrStatusStore.getState())?.setup_required).toBe(true);
  });
});
