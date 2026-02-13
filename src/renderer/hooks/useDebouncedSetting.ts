import { useCallback, useRef } from "react";
import { trpc } from "@/trpc";

/**
 * Returns a debounced setter that persists a value to the settings table,
 * plus the current persisted value (or null if not yet set).
 */
export function useDebouncedSetting(key: string, debounceMs = 300) {
  const query = trpc.settings.get.useQuery({ key });
  const mutation = trpc.settings.set.useMutation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setValue = useCallback(
    (value: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        mutation.mutate({ key, value });
      }, debounceMs);
    },
    [key, debounceMs, mutation],
  );

  return { value: query.data ?? null, setValue, isLoading: query.isLoading };
}
