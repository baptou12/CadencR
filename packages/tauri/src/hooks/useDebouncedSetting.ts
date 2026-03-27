import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey,
} from "../api/generated";

/**
 * Returns a debounced setter that persists a value to the settings table,
 * plus the current persisted value (or null if not yet set).
 */
export function useDebouncedSetting(key: string, debounceMs = 300) {
  const query = useGetWorkspaceSetting(key);
  const mutation = useSetWorkspaceSetting();
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setValue = useCallback(
    (value: string) => {
      // Update cache immediately so UI responds instantly
      queryClient.setQueryData(getGetWorkspaceSettingQueryKey(key), { value });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        mutation.mutate(
          { key, value },
          {
            onSuccess: () => {
              void queryClient.invalidateQueries({ queryKey: getGetWorkspaceSettingQueryKey(key) });
            },
          },
        );
      }, debounceMs);
    },
    [key, debounceMs, mutation, queryClient],
  );

  return { value: query.data?.value ?? null, setValue, isLoading: query.isLoading };
}
