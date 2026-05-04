import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getGetUnifiedAgentsQueryKey,
  usePinAgent,
  useUnpinAgent,
  type UnifiedAgentEntry,
} from "@/api/generated";
import { invalidateByUrlPrefix } from "@/lib/queryClient";

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
  const invalidateAgents = useCallback((): void => {
    void invalidateByUrlPrefix(queryClient, getGetUnifiedAgentsQueryKey()[0]);
  }, [queryClient]);
  const onError = useCallback((error: unknown): void => {
    const message = error instanceof Error ? error.message : "Failed to update pinned agent.";
    toast.error(message);
  }, []);
  const pinMutation = usePinAgent({ mutation: { onSuccess: invalidateAgents, onError } });
  const unpinMutation = useUnpinAgent({ mutation: { onSuccess: invalidateAgents, onError } });
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
