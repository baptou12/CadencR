import { useIsMutating } from "@tanstack/react-query";

export function gitUpdateMutationKey(featureId: number): readonly ["git-update", number] {
  return ["git-update", featureId];
}

export function useGitUpdatePending(featureId: number): boolean {
  return (
    useIsMutating({
      mutationKey: gitUpdateMutationKey(featureId),
      exact: true,
    }) > 0
  );
}
