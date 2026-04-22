import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/generated", () => ({
  getGetFeatureQueryKey: (id: number) => ["features", "detail", id],
  getGetFeaturePrdQueryKey: (id: number) => ["features", "prd", id],
  getGetFeaturePlanQueryKey: (id: number) => ["features", "plan", id],
  getGetFeaturePlanProgressQueryKey: (id: number) => ["features", "planProgress", id],
  getGetFeatureSettingsQueryKey: (id: number) => ["features", "settings", id],
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args) },
}));

import { invalidateFeatureQueries } from "./featureUpdated";

describe("invalidateFeatureQueries", () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
  });

  it("invalidates the feature detail and list query when title changes", () => {
    invalidateFeatureQueries(42, ["title"]);
    // title now also invalidates the list so the sidebar picks up the new title
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "detail", 42],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "list"],
      exact: false,
    });
  });

  it("invalidates multiple keys for multiple changed fields", () => {
    invalidateFeatureQueries(1, ["title", "prd", "settings"]);
    // title, prd, settings + the list invalidation triggered by title
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(4);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["features", "detail", 1] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["features", "prd", 1] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["features", "settings", 1] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "list"],
      exact: false,
    });
  });

  it("deduplicates when 'plan' and 'phases' both resolve to the same key", () => {
    invalidateFeatureQueries(5, ["plan", "phases"]);
    expect(mockInvalidateQueries).toHaveBeenCalledOnce();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "plan", 5],
    });
  });

  it("ignores unknown changed fields", () => {
    invalidateFeatureQueries(1, ["unknown_field", "also_unknown"]);
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it("handles empty changed array", () => {
    invalidateFeatureQueries(1, []);
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it("handles all known fields at once", () => {
    invalidateFeatureQueries(7, [
      "title",
      "plan",
      "prd",
      "phases",
      "progress",
      "settings",
      "status",
    ]);
    // plan and phases share a key, title and status share a key, so 5 unique + 1 list invalidation
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(6);
  });

  it("invalidates feature query and list query for status field", () => {
    invalidateFeatureQueries(10, ["status"]);
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "detail", 10],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "list"],
      exact: false,
    });
  });

  it("deduplicates when 'title' and 'status' both resolve to the feature query key", () => {
    invalidateFeatureQueries(3, ["title", "status"]);
    // 1 unique feature detail key + 1 list invalidation for status
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "detail", 3],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "list"],
      exact: false,
    });
  });
});
