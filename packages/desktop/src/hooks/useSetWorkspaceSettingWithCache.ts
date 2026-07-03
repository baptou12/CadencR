import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getGetWorkspaceSettingQueryKey, useSetWorkspaceSetting } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";

interface UseSetWorkspaceSettingWithCacheResult {
  /** Persist the value, await the backend, then patch the cache. Toasts + rethrows on error. */
  setValue: (value: string) => Promise<void>;
  isPending: boolean;
}

/**
 * Non-debounced workspace-setting writer that synchronizes the React Query
 * cache after the backend confirms the write — so callers don't have to
 * repeat the same `mutateAsync` + `setQueryData` + error-toast plumbing for
 * every key.
 *
 * No optimistic updates (per `.claude/rules/no-optimistic-updates.md`): the
 * cache is only patched once the mutation resolves successfully. Callers
 * that want to know about a failure can `await` the returned promise; ones
 * that fire-and-forget (e.g. the welcome intro) can `.catch(() => {})`.
 */
export function useSetWorkspaceSettingWithCache(
  key: string,
): UseSetWorkspaceSettingWithCacheResult {
  const mutation = useSetWorkspaceSetting();
  const queryClient = useQueryClient();

  const setValue = useCallback(
    async (value: string): Promise<void> => {
      try {
        await mutation.mutateAsync({ key, data: { value } });
        queryClient.setQueryData(getGetWorkspaceSettingQueryKey(key), { value });
      } catch (err: unknown) {
        const message = apiErrorMessage(err, "Unknown error");
        toast.error(`Could not save setting "${key}": ${message}`);
        throw err;
      }
    },
    [key, mutation, queryClient],
  );

  return useMemo<UseSetWorkspaceSettingWithCacheResult>(
    () => ({ setValue, isPending: mutation.isPending }),
    [setValue, mutation.isPending],
  );
}
