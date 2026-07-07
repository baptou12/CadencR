import {
  getListTerminalSessionsQueryKey,
  listTerminalSessions,
  type ListTerminalSessionsParams,
  type TerminalSessionInfo,
} from "@/api/generated";
import { queryClient } from "@/lib/queryClient";

const TERMINAL_SESSIONS_DEDUPE_MS = 3000;

interface FetchTerminalSessionsOptions {
  /** Force a live snapshot (staleTime 0) instead of reusing the dedupe window. */
  fresh?: boolean;
}

/**
 * Deduplicated read of a feature's live terminal sessions.
 *
 * Routing the imperative lookups through `fetchQuery` lets the concurrent mounts
 * on startup (feature cards, terminal tabs, the worktree auto-switch reconciler)
 * share one in-flight request and reuse the result within
 * {@link TERMINAL_SESSIONS_DEDUPE_MS}, collapsing the ~20-request storm we
 * measured into a single `GET /api/terminal/sessions`. Errors propagate to the
 * caller, which already degrades gracefully.
 */
export function fetchTerminalSessions(
  featureId: number,
  options?: FetchTerminalSessionsOptions,
): Promise<TerminalSessionInfo[]> {
  const params: ListTerminalSessionsParams = { feature_id: featureId };
  return queryClient.fetchQuery({
    queryKey: getListTerminalSessionsQueryKey(params),
    queryFn: ({ signal }) => listTerminalSessions(params, signal),
    staleTime: options?.fresh ? 0 : TERMINAL_SESSIONS_DEDUPE_MS,
  });
}
