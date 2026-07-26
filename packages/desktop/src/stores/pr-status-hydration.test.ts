import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPrStatuses } from "@/api/generated";
import { queryClient } from "@/lib/queryClient";
import { refreshPrStatusesAfterAuth } from "@/stores/pr-status-hydration";
import { usePrStatusStore } from "@/stores/usePrStatusStore";

vi.mock("@/api/generated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/generated")>();
  return {
    ...actual,
    getPrStatuses: vi.fn(),
  };
});

describe("refreshPrStatusesAfterAuth", () => {
  beforeEach(() => {
    usePrStatusStore.setState({ byFeature: {}, latestFetchedAtByFeature: {} });
    vi.mocked(getPrStatuses).mockReset();
  });

  it("hydrates the status store and invalidates mounted PR comment queries", async () => {
    vi.mocked(getPrStatuses).mockResolvedValue([
      {
        setup_required: false,
        feature_id: 42,
        fetched_at: 2,
        pr: null,
        ci: null,
        error: null,
      },
    ]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    await refreshPrStatusesAfterAuth();

    expect(usePrStatusStore.getState().byFeature[42]?.setup_required).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/git/pr/comments"] });
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
