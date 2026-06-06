/**
 * Frozen display order for the sidebar's project list.
 *
 * The backend always returns projects sorted by their most recent user
 * message (the canonical sort). We do NOT want that order to shuffle while
 * the user works — projects should only re-sort when the app starts or when
 * the user explicitly asks for a refresh. So this store holds the project
 * order captured at those two moments and keeps it stable across the
 * automatic background refetches that happen during a session.
 *
 * Lifecycle (driven by `useOrderedProjects`):
 * - App start: store is empty (`order === null`). The first fetch calls
 *   `reconcile`, which adopts the backend order verbatim and freezes it.
 * - Background refresh: `reconcile` keeps the frozen order, dropping deleted
 *   projects and prepending newly-created ones (so a just-created project is
 *   visible without re-sorting the rest).
 * - Manual refresh: the caller refetches and then calls `freeze` with the
 *   fresh backend order, re-adopting the canonical sort.
 *
 * Conversations are intentionally NOT frozen here — they re-sort on every
 * fetch straight from the backend.
 *
 * Being in-memory, the store resets on a full app reload/restart, which is
 * exactly when projects are meant to re-sort.
 */
import { create } from "zustand";
import { intArraysEqual } from "@/lib/utils";

interface SidebarProjectOrderState {
  /** Frozen display order of project ids; `null` until the first fetch. */
  order: number[] | null;
  /**
   * Merge the latest fetched project ids into the frozen order.
   * First fetch adopts the backend order; later fetches keep it (adding new
   * projects at the front, removing deleted ones).
   */
  reconcile: (fetchedIds: number[]) => void;
  /** Force-adopt the given order (used by an explicit manual refresh). */
  freeze: (fetchedIds: number[]) => void;
}

export const useSidebarProjectOrderStore = create<SidebarProjectOrderState>((set) => ({
  order: null,
  reconcile: (fetchedIds) =>
    set((state) => {
      if (state.order === null) return { order: fetchedIds };
      const fetched = new Set(fetchedIds);
      const known = new Set(state.order);
      const newIds = fetchedIds.filter((id) => !known.has(id));
      const kept = state.order.filter((id) => fetched.has(id));
      const next = [...newIds, ...kept];
      // Return the same reference when nothing changed so consumers don't
      // re-render on every no-op background refetch.
      return intArraysEqual(next, state.order) ? state : { order: next };
    }),
  freeze: (fetchedIds) => set({ order: fetchedIds }),
}));
