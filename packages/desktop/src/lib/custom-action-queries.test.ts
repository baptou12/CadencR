import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { getGetCustomActionRunsQueryKey, getListCustomActionsQueryKey } from "@/api/generated";
import { invalidateCustomActionRunQueries } from "./custom-action-queries";

describe("invalidateCustomActionRunQueries", () => {
  it("invalidates the action's runs and the project's action list", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    invalidateCustomActionRunQueries({ queryClient, projectId: 1, actionId: 7, featureId: 42 });

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getGetCustomActionRunsQueryKey(7, { feature_id: 42 }),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getListCustomActionsQueryKey({ project_id: 1, feature_id: 42 }),
    });
  });
});
