import type { ManagedTab } from "./browser-tab-events";

export const MAX_NETWORK_PER_TAB = 2000;

export function countTabsByScope(tabs: Iterable<ManagedTab>): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const tab of tabs) {
    const scope = tab.metadata.scopeId;
    if (scope === null) continue;
    counts[scope] = (counts[scope] ?? 0) + 1;
  }
  return counts;
}

export function tabCountRecordsEqual(
  left: Record<number, number>,
  right: Record<number, number>,
): boolean {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[Number(key)] === right[Number(key)])
  );
}
