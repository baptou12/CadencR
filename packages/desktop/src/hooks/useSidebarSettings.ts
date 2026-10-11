import { useCallback, useMemo } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetWorkspaceSettingQueryKey,
  getGetWorkspaceSettingQueryOptions,
  useSetWorkspaceSetting,
  useSetWorkspaceSettingsBatch,
  type SettingValueResponse,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import {
  parseSidebarConfig,
  serializeSidebarOption,
  SIDEBAR_OPTIONS,
  SIDEBAR_SETTING_KEYS,
  type SidebarConfig,
  type SidebarOptionId,
} from "@/lib/sidebar-config";

interface SidebarSettings {
  config: SidebarConfig;
  /** False until every key settled once: the config is still all defaults. */
  isFetched: boolean;
}

interface SettingResult {
  data?: SettingValueResponse;
  isFetched: boolean;
}

// Module-level so TanStack can memoize the combined result between renders.
function combineSidebarSettings(results: SettingResult[]): SidebarSettings {
  const byKey = new Map(SIDEBAR_SETTING_KEYS.map((key, index) => [key, results[index]]));
  return {
    config: parseSidebarConfig((key) => byKey.get(key)?.data?.value),
    isFetched: results.every((result) => result.isFetched),
  };
}

/**
 * The sidebar display options straight from the settings queries. Each key is
 * its own query, but `api/client.ts` serves them all from one bulk request.
 * Never stale on a timer: writes patch the cache and the settings watcher's
 * `settings_event` invalidates it, so remounting the form refetches nothing.
 * Rows read the mirrored store instead (see `useSidebarOption`).
 */
export function useSidebarSettings(): SidebarSettings {
  return useQueries({
    queries: SIDEBAR_SETTING_KEYS.map((key) =>
      getGetWorkspaceSettingQueryOptions(key, { query: { staleTime: Infinity } }),
    ),
    combine: combineSidebarSettings,
  });
}

type SetSidebarOption = <K extends SidebarOptionId>(id: K, value: SidebarConfig[K]) => void;

/**
 * Persists one option. Like every setting, the cache only moves once the write
 * is confirmed (no optimistic updates); a failed write says why.
 */
export function useSetSidebarOption(): SetSidebarOption {
  const queryClient = useQueryClient();
  const { mutate } = useSetWorkspaceSetting();
  return useCallback<SetSidebarOption>(
    (id, value) => {
      const key = SIDEBAR_OPTIONS[id].key;
      const serialized = serializeSidebarOption(value);
      mutate(
        { key, data: { value: serialized } },
        {
          onSuccess: () =>
            queryClient.setQueryData(getGetWorkspaceSettingQueryKey(key), { value: serialized }),
          onError: (error) =>
            toast.error(
              `Could not save sidebar option: ${apiErrorMessage(error, "Unknown error")}`,
            ),
        },
      );
    },
    [mutate, queryClient],
  );
}

/**
 * Clears every display option in one write, so the defaults apply again. The
 * response seeds the sidebar keys; the settings watcher's echo refreshes the rest.
 */
export function useResetSidebarConfig(): { reset: () => void; isResetting: boolean } {
  const queryClient = useQueryClient();
  const { mutate, isPending } = useSetWorkspaceSettingsBatch({
    mutation: {
      onSuccess: (settings) => {
        for (const key of SIDEBAR_SETTING_KEYS) {
          const value = settings.find((setting) => setting.key === key)?.value ?? null;
          queryClient.setQueryData(getGetWorkspaceSettingQueryKey(key), { value });
        }
      },
      onError: (error) =>
        toast.error(`Could not reset the sidebar: ${apiErrorMessage(error, "Unknown error")}`),
    },
  });
  const reset = useCallback(() => {
    mutate({
      data: { values: Object.fromEntries(SIDEBAR_SETTING_KEYS.map((key) => [key, null])) },
    });
  }, [mutate]);
  return useMemo(() => ({ reset, isResetting: isPending }), [reset, isPending]);
}
