import { isFeatureEmpty, type Feature, type IsEmptyResponse } from "@/api/generated";

export type FeatureArchiveAction = "archive" | "delete";

export function getFeatureArchiveAction(feature: Feature, empty: boolean): FeatureArchiveAction {
  if (feature.status === "archived") return "delete";
  return empty ? "delete" : "archive";
}

export function getPendingFeatureArchiveAction(args: {
  feature: Feature | undefined;
  emptyResponse: IsEmptyResponse | undefined;
  isCheckingEmpty: boolean;
  hasEmptyCheckError: boolean;
}): FeatureArchiveAction | null {
  const { feature, emptyResponse, isCheckingEmpty, hasEmptyCheckError } = args;
  if (!feature) return null;
  if (feature.status === "archived") return "delete";
  if (isCheckingEmpty) return null;
  if (hasEmptyCheckError) return "archive";
  return getFeatureArchiveAction(feature, emptyResponse?.empty ?? false);
}

export function deleteFeatureDialogTitle(feature: Feature | undefined): string {
  return feature?.status === "archived" ? "Delete archived session?" : "Delete session?";
}

export async function resolveFeatureArchiveAction(feature: Feature): Promise<FeatureArchiveAction> {
  if (feature.status === "archived") return "delete";
  const emptyResponse = await isFeatureEmpty(feature.id);
  return getFeatureArchiveAction(feature, emptyResponse.empty);
}
