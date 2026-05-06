import { describe, expect, it, beforeEach } from "vitest";
import { getListFeatureWorktreesQueryKey, getListProjectWorktreesQueryKey } from "@/api/generated";
import { invalidateWorktreeQueries } from "@/lib/worktreeQueries";
import { queryClient } from "@/lib/queryClient";

describe("invalidateWorktreeQueries", () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it("invalidates the worktree query prefixes used by the sidebar", () => {
    const featureWorktreesKey = getListFeatureWorktreesQueryKey({ project_id: 1 });
    const projectWorktreesKey = getListProjectWorktreesQueryKey({ project_id: 1 });
    queryClient.setQueryData(featureWorktreesKey, []);
    queryClient.setQueryData(projectWorktreesKey, []);

    invalidateWorktreeQueries();

    expect(queryClient.getQueryState(featureWorktreesKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(projectWorktreesKey)?.isInvalidated).toBe(true);
  });
});
