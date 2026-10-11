import { createContext, useContext } from "react";
import { create } from "zustand";
import { useSidebarCollapsed } from "@/components/SidebarContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { useSidebarFilterQuery } from "@/stores/sidebar-filter-store";

/** Where a sidebar row is rendered: the project tree (and Pinned), "For me", the rail. */
export type SidebarSurface = "tree" | "for-me" | "rail";

interface SidebarSurfaceState {
  /** Whether the "For me" block is unfolded (it folds from its header). */
  forMeExpanded: boolean;
  toggleForMe: () => void;
}

export const useSidebarSurfaceStore = create<SidebarSurfaceState>((set) => ({
  forMeExpanded: true,
  toggleForMe: () => set((state) => ({ forMeExpanded: !state.forMeExpanded })),
}));

export const SidebarSurfaceContext = createContext<SidebarSurface>("tree");

/**
 * The surface whose rows auto-open a waiting conversation's gate popover. A
 * conversation can show in the rail, "For me" and the tree at once, and only
 * the most prominent one opens: the rail when the sidebar is collapsed behind a
 * conversation rail, else "For me" when it is on screen, else the tree. A
 * collapsed sidebar without a conversation rail opens none: its rows are off
 * screen. Derived from state rather than registered by effects, so every row
 * agrees in the very render a request appears (a popover opening on one
 * surface then closing would steal focus from the one that should stay open).
 */
function useGateAutoOpenOwner(): SidebarSurface | null {
  const { collapsed } = useSidebarCollapsed();
  const isMobile = useIsMobile();
  const rail = useSidebarOption("rail");
  const forMe = useSidebarOption("forMe");
  const filtering = useSidebarFilterQuery() !== "";
  const forMeExpanded = useSidebarSurfaceStore((state) => state.forMeExpanded);
  if (collapsed && !isMobile) {
    return rail === "conversations" || rail === "attention" ? "rail" : null;
  }
  return forMe && forMeExpanded && !filtering ? "for-me" : "tree";
}

/** Whether rows on the caller's surface own the gate popover's auto-open. */
export function useOwnsGateAutoOpen(): boolean {
  const surface = useContext(SidebarSurfaceContext);
  return useGateAutoOpenOwner() === surface;
}
