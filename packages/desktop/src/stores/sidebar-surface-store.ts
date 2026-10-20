import { createContext, useMemo } from "react";
import { create } from "zustand";

/**
 * Where a sidebar row is rendered: the project tree (and Pinned), "For me",
 * "In progress", "Recent", the rail.
 */
export type SidebarSurface = "tree" | "for-me" | "working" | "recent" | "rail";

/** The conversation blocks above the project list that are surfaces of their own. */
export type SidebarBlockSurface = Extract<SidebarSurface, "for-me" | "working" | "recent">;

/** Every block above the project list; Pinned's rows belong to the tree's surface. */
export type SidebarBlockId = SidebarBlockSurface | "pinned";

interface SidebarSurfaceState {
  /** Which blocks are unfolded (each folds from its header); all start open. */
  expanded: Readonly<Record<SidebarBlockId, boolean>>;
  toggleBlock: (block: SidebarBlockId) => void;
  /** For me's "Show more": every action shows, past the "For me shows" limit. */
  forMeShowAll: boolean;
  toggleForMeShowAll: () => void;
}

export const useSidebarSurfaceStore = create<SidebarSurfaceState>((set) => ({
  expanded: { "for-me": true, working: true, recent: true, pinned: true },
  toggleBlock: (block) =>
    set((state) => ({ expanded: { ...state.expanded, [block]: !state.expanded[block] } })),
  forMeShowAll: false,
  toggleForMeShowAll: () => set((state) => ({ forMeShowAll: !state.forMeShowAll })),
}));

/** A block's fold state and its toggle. */
export function useSidebarBlockFold(block: SidebarBlockId): {
  expanded: boolean;
  toggle: () => void;
} {
  const expanded = useSidebarSurfaceStore((state) => state.expanded[block]);
  const toggleBlock = useSidebarSurfaceStore((state) => state.toggleBlock);
  return useMemo(
    () => ({ expanded, toggle: () => toggleBlock(block) }),
    [block, expanded, toggleBlock],
  );
}

export const SidebarSurfaceContext = createContext<SidebarSurface>("tree");

/** While the sidebar is open: For me's rows when it is shown and unfolded, else the tree's. */
export function openSidebarGateOwner(forMeShown: boolean, filtering: boolean): SidebarSurface {
  return forMeShown && !filtering ? "for-me" : "tree";
}
