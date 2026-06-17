/**
 * Last-opened feature, used by the home route and the root error boundary to
 * navigate back to the user's most recent conversation on startup.
 *
 * This is per-device UI state, so it lives in `localStorage` (written by
 * `useSaveLastOpenedFeature`) rather than the backend settings file — there's
 * no reason to sync "which conversation I last had open" across machines, and
 * keeping it out of the settings JSON keeps that file to real configuration.
 */
export interface SavedFeature {
  projectId: number;
  featureId: number;
  activeTab?: string;
}

/** localStorage key for {@link SavedFeature}. */
const STORAGE_KEY = "cadencr:last-opened-feature";

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
    /* tolerate a corrupted value */
    return null;
  }
}

/** Read the last-opened feature from localStorage (returns null if unset/invalid). */
export function readSavedFeature(): SavedFeature | null {
  if (typeof window === "undefined") return null;
  return parseSavedFeature(window.localStorage.getItem(STORAGE_KEY));
}

/** Persist the last-opened feature to localStorage. */
export function writeSavedFeature(feature: SavedFeature): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(feature));
  } catch {
    /* storage full/disabled — last-opened restore is best-effort, never fatal */
  }
}
