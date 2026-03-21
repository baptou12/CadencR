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

  it("invalidates the correct query key for each changed field", () => {
    invalidateFeatureQueries(42, ["title"]);
    expect(mockInvalidateQueries).toHaveBeenCalledOnce();
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["features", "detail", 42],
    });
  });

  it("invalidates multiple keys for multiple changed fields", () => {
    invalidateFeatureQueries(1, ["title", "prd", "settings"]);
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(3);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["features", "detail", 1] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["features", "prd", 1] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["features", "settings", 1] });
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
    invalidateFeatureQueries(7, ["title", "plan", "prd", "phases", "progress", "settings"]);
    // plan and phases share a key, so 5 unique invalidations
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(5);
  });
});
