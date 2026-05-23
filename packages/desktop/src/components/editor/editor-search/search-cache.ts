export interface PaneSearchState {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}

const DEFAULT_STATE: PaneSearchState = { query: "", caseSensitive: false, regex: false };

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
