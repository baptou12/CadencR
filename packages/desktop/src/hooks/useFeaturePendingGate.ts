import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getPendingGate,
  respondGate,
  type FeatureGateDecision,
  type FeaturePendingGateResponse,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { queryClient } from "@/lib/queryClient";
import { useFeaturePendingRequestId } from "@/stores/pending-gate-popover-selectors";
import { toast } from "sonner";

interface UseFeaturePendingGateOptions {
  featureId: number;
  /** Fetch only while the popover is open — closed rows stay silent. */
  enabled: boolean;
}

interface UseFeaturePendingGateResult {
  gate: FeaturePendingGateResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  isSubmitting: boolean;
  respond: (decision: FeatureGateDecision) => void;
}

export function useFeaturePendingGate({
  featureId,
  enabled,
}: UseFeaturePendingGateOptions): UseFeaturePendingGateResult {
  // Include the live request id so a question→question transition (stacked /
  // sequential gates) cannot keep serving the previous gate's cached payload.
  const liveRequestId = useFeaturePendingRequestId(featureId);

  const query = useQuery({
    queryKey: ["/api/features", featureId, "pending-gate", liveRequestId ?? ""],
    queryFn: ({ signal }) => getPendingGate(featureId, signal),
    enabled,
    retry: false,
    staleTime: 0,
    // Pending gates are driven by WS status; window focus refetch is wasteful.
    refetchOnWindowFocus: false,
    // Drop unused payloads quickly — request ids rotate often.
    gcTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (decision: FeatureGateDecision) => {
      const requestId = query.data?.request_id;
      if (!requestId) {
        return Promise.reject(new Error("No pending gate to answer"));
      }
      if (liveRequestId && requestId !== liveRequestId) {
        return Promise.reject(new Error("Pending gate changed — refresh and try again"));
      }
      return respondGate(featureId, { request_id: requestId, decision });
    },
    onError: (error: unknown) => {
      toast.error(apiErrorMessage(error, "Could not answer pending request"));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["/api/features", featureId, "pending-gate"],
      });
    },
  });

  const respond = mutation.mutate;
  const isSubmitting = mutation.isPending;
  const gateMatchesLive =
    query.data != null && (liveRequestId == null || query.data.request_id === liveRequestId);
  const gate = gateMatchesLive ? query.data : undefined;

  return useMemo(
    () => ({
      gate,
      isLoading: query.isLoading,
      isError: query.isError && gate == null,
      errorMessage:
        query.isError && gate == null
          ? apiErrorMessage(query.error, "Could not load pending request")
          : null,
      isSubmitting,
      respond,
    }),
    [gate, isSubmitting, query.error, query.isError, query.isLoading, respond],
  );
}
