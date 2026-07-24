import { beforeEach, describe, expect, it } from "vitest";
import type { PrStatusSnapshot } from "@/api/generated";
import { selectPrStatus, usePrStatusStore } from "./usePrStatusStore";

function snapshot(featureId: number, fetchedAt: number): PrStatusSnapshot {
  return {
    feature_id: featureId,
    fetched_at: fetchedAt,
    auth_required: false,
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
});
