import { describe, expect, it } from "vitest";

import { getFileTreeLoadState, shouldFetchFullTree } from "./fileTreeLoadMode";

describe("shouldFetchFullTree", () => {
  it("waits for the count before fetching tree-all", () => {
    expect(
      shouldFetchFullTree({ count: undefined, isCountResolved: false, threshold: 5_000 }),
    ).toBe(false);
  });

  it("fetches tree-all only after a small count resolves", () => {
    expect(shouldFetchFullTree({ count: 42, isCountResolved: true, threshold: 5_000 })).toBe(true);
  });

  it("does not fetch tree-all for repositories over the lazy threshold", () => {
    expect(shouldFetchFullTree({ count: 5_001, isCountResolved: true, threshold: 5_000 })).toBe(
      false,
    );
  });
});

describe("getFileTreeLoadState", () => {
  it("shows a loading state while the count is pending", () => {
    expect(
      getFileTreeLoadState({
        lazyMode: false,
        countIsPending: true,
        countIsError: false,
        lazyTreeIsLoading: false,
        trackedIsLoading: false,
        trackedHasData: false,
        countError: null,
        lazyTreeError: null,
        trackedError: null,
        trackedIsError: false,
      }),
    ).toEqual({ isLoading: true, errorMessage: null });
  });

  it("surfaces count failures instead of leaving an empty tree", () => {
    expect(
      getFileTreeLoadState({
        lazyMode: false,
        countIsPending: false,
        countIsError: true,
        lazyTreeIsLoading: false,
        trackedIsLoading: false,
        trackedHasData: false,
        countError: null,
        lazyTreeError: null,
        trackedError: null,
        trackedIsError: false,
      }),
    ).toEqual({ isLoading: false, errorMessage: "Failed to count project files" });
  });

  it("uses backend error details when count failures include them", () => {
    expect(
      getFileTreeLoadState({
        lazyMode: false,
        countIsPending: false,
        countIsError: true,
        lazyTreeIsLoading: false,
        trackedIsLoading: false,
        trackedHasData: false,
        countError: new Error("count exploded"),
        lazyTreeError: null,
        trackedError: null,
        trackedIsError: false,
      }),
    ).toEqual({ isLoading: false, errorMessage: "count exploded" });
  });
});
