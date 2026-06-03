import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetUnifiedAgentsQueryKey,
  usePinAgent,
  useUnpinAgent,
  type UnifiedAgentEntry,
  type UnifiedAgentsResponse,
} from "@/api/generated";
import { urlPrefixPredicate } from "@/lib/queryClient";

interface UnifiedAgentPinControlOptions {
  showProgressToast?: boolean;
}

interface UnifiedAgentPinControls {
  isPending: boolean;
  toggle: () => void;
}

export function useUnifiedAgentPinControls(
  entry: UnifiedAgentEntry | null,
  options: UnifiedAgentPinControlOptions = {},
): UnifiedAgentPinControls {
  const queryClient = useQueryClient();
  // Pinning only flips `is_pinned` (and reorders the grid). Patch the cached
  // unified-agents responses in place rather than invalidating: a refetch
  // re-runs `list_unified_agents`, which serially re-hydrates every active
  // agent's full transcript (an N+1 over `get_feature_agent_state`) — far too
  // expensive for a boolean toggle. Client-side sort/filter
  // (`UnifiedAgentsViewData`) reorders from the patched `is_pinned`. Applied
  // on mutation success, so this is a confirmed write, not an optimistic one.
  const setPinnedInCache = useCallback(
    (sessionId: number, isPinned: boolean): void => {
      const urlKey = getGetUnifiedAgentsQueryKey()[0];
      if (typeof urlKey !== "string") return;
      queryClient.setQueriesData<UnifiedAgentsResponse>(
        { predicate: urlPrefixPredicate(urlKey) },
        (data) => {
          // Return the same reference when this cached response doesn't hold
          // the toggled agent — avoids re-rendering its subscribers for nothing.
          if (!data?.agents.some((agent) => agent.session.sessionDbId === sessionId)) return data;
          return {
            ...data,
            agents: data.agents.map((agent) =>
              agent.session.sessionDbId === sessionId ? { ...agent, is_pinned: isPinned } : agent,
            ),
          };
        },
      );
    },
    [queryClient],
  );
  const onError = useCallback((error: unknown): void => {
    const message = error instanceof Error ? error.message : "Failed to update pinned agent.";
    toast.error(message);
  }, []);
  const pinMutation = usePinAgent({
    mutation: {
      onSuccess: (_data, variables) => setPinnedInCache(variables.sessionId, true),
      onError,
    },
  });
  const unpinMutation = useUnpinAgent({
    mutation: {
      onSuccess: (_data, variables) => setPinnedInCache(variables.sessionId, false),
      onError,
    },
  });
  const pinAgent = pinMutation.mutate;
  const unpinAgent = unpinMutation.mutate;
  const isPending = pinMutation.isPending || unpinMutation.isPending;
  const toggle = useCallback((): void => {
    if (!entry || isPending) return;
    const toastId = showPinProgress(entry, options.showProgressToast === true);
    const callbacks = {
      onSettled: (): void => {
        if (toastId !== null) toast.dismiss(toastId);
      },
    };
    if (entry.is_pinned) unpinAgent({ sessionId: entry.session.sessionDbId }, callbacks);
    else pinAgent({ sessionId: entry.session.sessionDbId }, callbacks);
  }, [entry, isPending, options.showProgressToast, pinAgent, unpinAgent]);
  return useMemo(() => ({ isPending, toggle }), [isPending, toggle]);
}

function showPinProgress(entry: UnifiedAgentEntry, enabled: boolean): string | number | null {
  if (!enabled) return null;
  return toast.loading(entry.is_pinned ? "Unpinning agent…" : "Pinning agent…");
}
