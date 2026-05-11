import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

/**
 * Invalidate every cached query whose URL key starts with any of the given
 * prefixes.
 *
 * Orval emits per-endpoint query keys keyed by URL string (e.g.
 * `["/api/features", { project_id }]`, `["/api/features/123/plan/progress"]`).
 * React Query's default prefix matching only matches *array* prefixes, so a
 * key like `["/api/features"]` will NOT match `["/api/features/123"]` — the
 * first elements are different strings. This helper bridges that gap by doing
 * a string prefix check on `queryKey[0]`, which is how every orval key is
 * built. Pass an array to fold several prefixes into a single cache walk
 * (e.g. on a file-tree change, refresh editor + git stats together).
 */
export function invalidateByUrlPrefix(
  client: QueryClient,
  urlPrefix: string | readonly string[],
): Promise<void> {
  const prefixes = typeof urlPrefix === "string" ? [urlPrefix] : urlPrefix;
  return client.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      if (typeof head !== "string") return false;
      return prefixes.some((p) => head.startsWith(p));
    },
  });
}
