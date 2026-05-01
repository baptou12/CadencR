import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspaceSetting,
  useSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey,
  type SettingValueResponse,
} from "../api/generated";

/**
 * Returns a debounced setter that persists a value to the settings table,
 * plus the current persisted value (or null if not yet set).
 */
export function useDebouncedSetting(key: string, debounceMs = 300, { immediateCache = true } = {}) {
  const query = useGetWorkspaceSetting(key);
  const mutation = useSetWorkspaceSetting();
  const queryClient = useQueryClient();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect((): (() => void) => {
    return (): void => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const setValue = useCallback(
    (value: string) => {
      const queryKey = getGetWorkspaceSettingQueryKey(key);
      const previousValue = queryClient.getQueryData<SettingValueResponse>(queryKey);

      // Update cache immediately so UI responds instantly (skip for continuous
      // updates like drag-resize where re-renders disrupt the interaction)
      if (immediateCache) {
        queryClient.setQueryData(queryKey, { value });
      }

      if (timerRef.current) clearTimeout(timerRef.current);

      const persistValue = (): void => {
        mutation.mutate(
          { key, data: { value } },
          {
            onSuccess: () => {
              if (!immediateCache) queryClient.setQueryData(queryKey, { value });
            },
            onError: (err: unknown) => {
              if (immediateCache) {
                if (previousValue === undefined) {
                  void queryClient.invalidateQueries({ queryKey });
                } else {
                  queryClient.setQueryData(queryKey, previousValue);
                }
              }
              const message = err instanceof Error ? err.message : "Unknown error";
              toast.error(`Could not save setting "${key}": ${message}`);
            },
          },
        );
      };

      if (debounceMs <= 0) {
        persistValue();
        return;
      }

      timerRef.current = setTimeout(persistValue, debounceMs);
    },
    [key, debounceMs, immediateCache, mutation, queryClient],
  );

  return { value: query.data?.value ?? null, setValue, isLoading: query.isLoading };
}
