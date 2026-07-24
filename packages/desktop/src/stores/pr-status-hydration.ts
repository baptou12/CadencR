import { toast } from "sonner";
import { getGetPrCommentsQueryKey, getPrStatuses } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { queryClient } from "@/lib/queryClient";
import { usePrStatusStore } from "@/stores/usePrStatusStore";

export async function hydratePrStatuses(): Promise<void> {
  try {
    const snapshots = await getPrStatuses();
    usePrStatusStore.getState().hydrate(snapshots);
  } catch (error) {
    toast.error("Could not load pull request status.", {
      description: apiErrorMessage(error, "Forge status request failed"),
    });
  }
}

export async function refreshPrStatusesAfterAuth(): Promise<void> {
  try {
    await Promise.all([
      hydratePrStatuses(),
      queryClient.invalidateQueries({ queryKey: getGetPrCommentsQueryKey() }),
    ]);
  } catch (error) {
    toast.error("Connected, but pull request views could not refresh.", {
      description: apiErrorMessage(error, "Forge query invalidation failed"),
    });
  }
}
