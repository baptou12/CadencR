import { intArraysEqual } from "@/lib/utils";

/**
 * Merge freshly fetched ids into a frozen display order: existing ids keep
 * their place, new ids go on top, removed ids drop out. Returns `previous`
 * itself when nothing changed so consumers can bail out of re-renders.
 */
export function reconcileFrozenOrder(
  previous: readonly number[],
  fetched: readonly number[],
): readonly number[] {
  const fetchedSet = new Set(fetched);
  const known = new Set(previous);
  const next = [
    ...fetched.filter((id) => !known.has(id)),
    ...previous.filter((id) => fetchedSet.has(id)),
  ];
  return intArraysEqual(next, previous) ? previous : next;
}

/**
 * Sorts by a frozen order. Unknown ids (newly created, not yet reconciled into
 * `order`) sort to the front, keeping their incoming relative order.
 */
export function applyOrder<T extends { id: number }>(
  items: readonly T[],
  order: readonly number[] | null,
): T[] {
  if (order === null) return [...items];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
}
