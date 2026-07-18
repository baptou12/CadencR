import { useIsMutating } from "@tanstack/react-query";

import { useGitUpdateRecoveryStore } from "./gitUpdateRecoveryStore";

export function gitUpdateMutationKey(featureId: number): readonly ["git-update", number] {
  return ["git-update", featureId];
}

export function useGitUpdatePending(featureId: number): boolean {
  const activeRequests = useIsMutating({
    mutationKey: gitUpdateMutationKey(featureId),
    exact: true,
  });
  const settling = useGitUpdateRecoveryStore(
    (state) => state.byFeature[featureId]?.settling ?? false,
  );
  return activeRequests > 0 || settling;
}
