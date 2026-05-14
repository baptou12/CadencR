import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/generated", () => ({
  getGetFeatureQueryKey: (id: number) => [`/api/features/${id}`],
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
    invalidateFeatureQueries(1, ["title", "settings"]);
    // title (= feature detail), settings + the list invalidation triggered by title
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(3);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/features/1"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/features/1/settings"] });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/features"],
      exact: false,
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

  it("deduplicates when 'title' and 'label' both resolve to the feature query key", () => {
    invalidateFeatureQueries(3, ["title", "label"]);
    // 1 unique feature detail key + 1 list invalidation
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
