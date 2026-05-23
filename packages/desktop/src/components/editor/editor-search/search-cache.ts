export interface PaneSearchState {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  /**
   * Persisted replacement string. Survives panel close/reopen within a
   * pane. Optional for backward compatibility with callers that predate
   * the replace UI; reads default to `""`.
   */
  replacement?: string;
}

const DEFAULT_STATE: PaneSearchState = {
  query: "",
  caseSensitive: false,
  regex: false,
  replacement: "",
};

const cache = new Map<string, PaneSearchState>();

function keyOf(featureId: number, paneId: string): string {
  return `${featureId}:${paneId}`;
}

export function getPaneSearch(featureId: number, paneId: string): PaneSearchState {
  return cache.get(keyOf(featureId, paneId)) ?? DEFAULT_STATE;
}

export function setPaneSearch(featureId: number, paneId: string, state: PaneSearchState): void {
  cache.set(keyOf(featureId, paneId), state);
}

/** Drop the cached search state for a single pane (called on EditorPane unmount). */
export function clearPaneSearch(featureId: number, paneId: string): void {
  cache.delete(keyOf(featureId, paneId));
}

/** Drop every cached entry for a feature (called when the feature is closed). */
export function clearFeatureSearch(featureId: number): void {
  const prefix = `${featureId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
