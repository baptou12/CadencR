import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/generated", () => ({
  getGetFeatureQueryKey: (id: number) => [`/api/features/${id}`],
  getGetFeaturePrdQueryKey: (id: number) => [`/api/features/${id}/prd`],
  getGetFeaturePlanQueryKey: (id: number) => [`/api/features/${id}/plan`],
  getGetFeaturePlanProgressQueryKey: (id: number) => [`/api/features/${id}/plan/progress`],
  getGetFeatureSettingsQueryKey: (id: number) => [`/api/features/${id}/settings`],
  getListFeaturesQueryKey: () => ["/api/features"],
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
      queryKey: ["/api/features/42"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features"],
      exact: false,
    });
  });

  it("invalidates multiple keys for multiple changed fields", () => {
    invalidateFeatureQueries(1, ["title", "prd", "settings"]);
    // title, prd, settings + the list invalidation triggered by title
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(4);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/features/1"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/features/1/prd"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/features/1/settings"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features"],
      exact: false,
    });
  });

  it("deduplicates when 'plan' and 'phases' both resolve to the same key", () => {
    invalidateFeatureQueries(5, ["plan", "phases"]);
    expect(mockInvalidateQueries).toHaveBeenCalledOnce();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features/5/plan"],
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
      queryKey: ["/api/features/10"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features"],
      exact: false,
    });
  });

  it("deduplicates when 'title' and 'status' both resolve to the feature query key", () => {
    invalidateFeatureQueries(3, ["title", "status"]);
    // 1 unique feature detail key + 1 list invalidation for status
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(2);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features/3"],
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features"],
      exact: false,
    });
  });
});
