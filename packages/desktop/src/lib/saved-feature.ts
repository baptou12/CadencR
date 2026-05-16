/**
 * Shape of the `lastOpenedFeature` workspace setting written by
 * `useSaveLastOpenedFeature` and read by the home route and the root error
 * boundary to navigate back to the user's most recent conversation.
 */
export interface SavedFeature {
  projectId: number;
  featureId: number;
  activeTab?: string;
}

export function parseSavedFeature(value: string | undefined | null): SavedFeature | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SavedFeature>;
    if (typeof parsed.projectId !== "number" || typeof parsed.featureId !== "number") return null;
    return {
      projectId: parsed.projectId,
      featureId: parsed.featureId,
      activeTab: typeof parsed.activeTab === "string" ? parsed.activeTab : undefined,
    };
  } catch {
    /* tolerate a corrupted workspace setting */
    return null;
  }
}
