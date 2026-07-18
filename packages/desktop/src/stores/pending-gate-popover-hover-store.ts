import { create } from "zustand";

/**
 * Tracks which pending-gate popover the pointer is over so a newer agent's
 * auto-open does not dismiss a popover the user is still reading/answering.
 */
interface PendingGatePopoverHoverState {
  hoveredFeatureId: number | null;
  setHovered: (featureId: number | null) => void;
}

export const usePendingGatePopoverHoverStore = create<PendingGatePopoverHoverState>((set) => ({
  hoveredFeatureId: null,
  setHovered: (featureId) => set({ hoveredFeatureId: featureId }),
}));
