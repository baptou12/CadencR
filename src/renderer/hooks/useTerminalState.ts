import { useCallback } from "react";
import { create } from "zustand";

/** State for a single terminal pane */
export interface TerminalPane {
  id: string;
  /** PTY ID assigned by the backend — set after creation, used for reconnection */
  ptyId?: string;
}

/** State for the terminal panel for a given feature */
export interface TerminalPanelState {
  /** Whether the terminal panel is visible */
  isOpen: boolean;
  /** Whether the panel is minimized (PTYs still alive, just hidden) */
  isMinimized: boolean;
  /** Array of active terminal panes */
  panes: TerminalPane[];
}

const defaultState: TerminalPanelState = {
  isOpen: false,
  isMinimized: false,
  panes: [],
};

let paneCounter = 0;
function nextPaneId(): string {
  return `pane-${Date.now()}-${++paneCounter}`;
}

// ---------------------------------------------------------------------------
// Zustand store — keyed by featureId so terminal state persists across
// route navigations. PTYs stay alive in the backend while panes exist.
// ---------------------------------------------------------------------------

interface TerminalStore {
  /** Per-feature terminal panel state */
  features: Record<number, TerminalPanelState>;

  /** Get state for a feature (returns default if not yet initialized) */
  getFeature: (featureId: number) => TerminalPanelState;

  togglePanel: (featureId: number) => void;
  addPane: (featureId: number) => void;
  removePane: (featureId: number, paneId: string) => void;
  minimize: (featureId: number) => void;
  closePanel: (featureId: number) => void;

  /** Associate a backend PTY ID with a pane (called after PTY creation) */
  setPtyId: (featureId: number, paneId: string, ptyId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  features: {},

  getFeature: (featureId) => get().features[featureId] ?? defaultState,

  togglePanel: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      let next: TerminalPanelState;

      if (prev.panes.length === 0) {
        next = { isOpen: true, isMinimized: false, panes: [{ id: nextPaneId() }] };
      } else if (prev.isOpen) {
        next = { ...prev, isOpen: false, isMinimized: false };
      } else {
        next = { ...prev, isOpen: true, isMinimized: false };
      }

      return { features: { ...state.features, [featureId]: next } };
    }),

  addPane: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      return {
        features: {
          ...state.features,
          [featureId]: { ...prev, panes: [...prev.panes, { id: nextPaneId() }] },
        },
      };
    }),

  removePane: (featureId, paneId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      const remaining = prev.panes.filter((p) => p.id !== paneId);
      const next =
        remaining.length === 0
          ? { isOpen: false, isMinimized: false, panes: [] as TerminalPane[] }
          : { ...prev, panes: remaining };
      return { features: { ...state.features, [featureId]: next } };
    }),

  minimize: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      return { features: { ...state.features, [featureId]: { ...prev, isMinimized: true } } };
    }),

  closePanel: (featureId) =>
    set((state) => ({
      features: {
        ...state.features,
        [featureId]: { isOpen: false, isMinimized: false, panes: [] },
      },
    })),

  setPtyId: (featureId, paneId, ptyId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      return {
        features: {
          ...state.features,
          [featureId]: {
            ...prev,
            panes: prev.panes.map((p) => (p.id === paneId ? { ...p, ptyId } : p)),
          },
        },
      };
    }),
}));

// ---------------------------------------------------------------------------
// Convenience hook — returns the same interface as before so callers barely
// need to change.
// ---------------------------------------------------------------------------

export function useTerminalState(featureId: number) {
  const state = useTerminalStore((s) => s.getFeature(featureId));
  const store = useTerminalStore();

  const togglePanel = useCallback(() => store.togglePanel(featureId), [store, featureId]);
  const addPane = useCallback(() => store.addPane(featureId), [store, featureId]);
  const removePane = useCallback((paneId: string) => store.removePane(featureId, paneId), [store, featureId]);
  const minimize = useCallback(() => store.minimize(featureId), [store, featureId]);
  const closePanel = useCallback(() => store.closePanel(featureId), [store, featureId]);

  return {
    ...state,
    togglePanel,
    addPane,
    removePane,
    minimize,
    closePanel,
  };
}
