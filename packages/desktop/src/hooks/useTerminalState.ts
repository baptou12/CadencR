import { useCallback } from "react";
import { create } from "zustand";
import {
  getLeaves,
  removeLeaf,
  replaceLeaf,
  splitLeaf,
  updateLeaf,
  type SplitNode,
  type SplitOrientation,
  type TerminalLeaf,
} from "./terminal-tree";

// Re-export tree types so existing consumers keep importing from this module.
export type { SplitOrientation, TerminalLeaf, TerminalSplit, SplitNode } from "./terminal-tree";
export { getLeaves, findAdjacentLeaf } from "./terminal-tree";

/** Flat pane info exposed to callers that don't need the tree structure */
interface TerminalPane {
  id: string;
  ptyId?: string;
  initialCommand?: string;
  cwd?: string;
  cwdWarningDismissed?: boolean;
}

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------

export interface TerminalPanelState {
  isOpen: boolean;
  isMinimized: boolean;
  /** Root of the split tree, or null when no panes exist */
  root: SplitNode | null;
}

/** Derived flat pane list for convenience */
function getPanes(state: TerminalPanelState): TerminalPane[] {
  if (!state.root) return [];
  return getLeaves(state.root);
}

const defaultState: TerminalPanelState = {
  isOpen: false,
  isMinimized: false,
  root: null,
};

let paneCounter = 0;
function nextPaneId(): string {
  return `pane-${Date.now()}-${++paneCounter}`;
}

function makeLeaf(overrides?: Partial<TerminalLeaf>): TerminalLeaf {
  return { type: "leaf", id: nextPaneId(), ...overrides };
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

interface TerminalStore {
  features: Record<number, TerminalPanelState>;
  getFeature: (featureId: number) => TerminalPanelState;

  togglePanel: (featureId: number) => void;
  /**
   * Split the active pane (by leafId) in the given orientation. If no leafId,
   * splits the last leaf. Returns the id of the newly-created leaf so callers
   * can immediately focus it.
   */
  splitPane: (
    featureId: number,
    leafId: string | undefined,
    orientation: SplitOrientation,
  ) => string | null;
  /**
   * Add a pane (no specific split target — appends to last leaf). Used for
   * simple "new pane" actions. Returns the id of the newly-created leaf.
   */
  addPane: (featureId: number) => string | null;
  removePane: (featureId: number, paneId: string) => void;
  /**
   * Replace a leaf in-place with a fresh empty leaf (new id, no ptyId).
   * The tree structure is preserved so split layouts survive a restart.
   * The caller is responsible for having killed the old PTY.
   */
  replaceLeafWithFresh: (featureId: number, paneId: string) => void;
  minimize: (featureId: number) => void;
  closePanel: (featureId: number) => void;
  setPtyId: (featureId: number, paneId: string, ptyId: string) => void;
  setPaneCwd: (featureId: number, paneId: string, cwd: string) => void;
  dismissCwdWarning: (featureId: number, paneId: string) => void;
  sendToTerminal: (featureId: number, command: string) => void;
  clearInitialCommand: (featureId: number, paneId: string) => void;
}

function updateFeature(
  state: { features: Record<number, TerminalPanelState> },
  featureId: number,
  next: TerminalPanelState,
): { features: Record<number, TerminalPanelState> } {
  return { features: { ...state.features, [featureId]: next } };
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  features: {},

  getFeature: (featureId) => get().features[featureId] ?? defaultState,

  togglePanel: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) {
        return updateFeature(state, featureId, {
          isOpen: true,
          isMinimized: false,
          root: makeLeaf(),
        });
      }
      if (prev.isOpen) {
        return updateFeature(state, featureId, { ...prev, isOpen: false, isMinimized: false });
      }
      return updateFeature(state, featureId, { ...prev, isOpen: true, isMinimized: false });
    }),

  splitPane: (featureId, leafId, orientation) => {
    // Build the new leaf outside the set() so we can return its id to the
    // caller. The store still owns id generation via `makeLeaf` so behaviour
    // is unchanged — we just expose what we created.
    let createdId: string | null = null;
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) {
        const newLeaf = makeLeaf();
        createdId = newLeaf.id;
        return updateFeature(state, featureId, {
          isOpen: true,
          isMinimized: false,
          root: newLeaf,
        });
      }
      const targetId = leafId ?? getLeaves(prev.root).at(-1)?.id;
      if (!targetId) return state;
      const newLeaf = makeLeaf();
      const newRoot = splitLeaf(prev.root, targetId, orientation, newLeaf);
      createdId = newLeaf.id;
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    });
    return createdId;
  },

  addPane: (featureId) => {
    let createdId: string | null = null;
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) {
        const newLeaf = makeLeaf();
        createdId = newLeaf.id;
        return updateFeature(state, featureId, { ...prev, root: newLeaf });
      }
      // Default: horizontal split on the last leaf
      const lastLeaf = getLeaves(prev.root).at(-1);
      if (!lastLeaf) return state;
      const newLeaf = makeLeaf();
      const newRoot = splitLeaf(prev.root, lastLeaf.id, "horizontal", newLeaf);
      createdId = newLeaf.id;
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    });
    return createdId;
  },

  removePane: (featureId, paneId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = removeLeaf(prev.root, paneId);
      if (!newRoot) {
        return updateFeature(state, featureId, { isOpen: false, isMinimized: false, root: null });
      }
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

  replaceLeafWithFresh: (featureId, paneId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = replaceLeaf(prev.root, paneId, makeLeaf());
      if (newRoot === prev.root) return state;
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

  minimize: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      return updateFeature(state, featureId, { ...prev, isMinimized: true });
    }),

  closePanel: (featureId) => set((state) => updateFeature(state, featureId, { ...defaultState })),

  setPtyId: (featureId, paneId, ptyId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = updateLeaf(prev.root, paneId, (leaf) =>
        leaf.ptyId === ptyId ? leaf : { ...leaf, ptyId },
      );
      if (newRoot === prev.root) return state;
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

  setPaneCwd: (featureId, paneId, cwd) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = updateLeaf(prev.root, paneId, (leaf) =>
        leaf.cwd === cwd ? leaf : { ...leaf, cwd },
      );
      if (newRoot === prev.root) return state;
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

  dismissCwdWarning: (featureId, paneId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = updateLeaf(prev.root, paneId, (leaf) =>
        leaf.cwdWarningDismissed ? leaf : { ...leaf, cwdWarningDismissed: true },
      );
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

  sendToTerminal: (featureId, command) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      const newLeaf = makeLeaf({ initialCommand: command });

      if (!prev.root) {
        return updateFeature(state, featureId, { isOpen: true, isMinimized: false, root: newLeaf });
      }
      const lastLeaf = getLeaves(prev.root).at(-1);
      if (!lastLeaf) return state;
      const newRoot = splitLeaf(prev.root, lastLeaf.id, "horizontal", newLeaf);
      return updateFeature(state, featureId, {
        ...prev,
        isOpen: true,
        isMinimized: false,
        root: newRoot,
      });
    }),

  clearInitialCommand: (featureId, paneId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = updateLeaf(prev.root, paneId, (leaf) => ({
        ...leaf,
        initialCommand: undefined,
      }));
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),
}));

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useTerminalState(featureId: number) {
  // Subscribe only to this feature's slice. Actions are read via getState()
  // so the consumer doesn't re-render on every store mutation.
  const state = useTerminalStore((s) => s.getFeature(featureId));

  const panes = getPanes(state);
  const togglePanel = useCallback(
    () => useTerminalStore.getState().togglePanel(featureId),
    [featureId],
  );
  const splitPane = useCallback(
    (leafId: string | undefined, orientation: SplitOrientation): string | null =>
      useTerminalStore.getState().splitPane(featureId, leafId, orientation),
    [featureId],
  );
  const addPane = useCallback(
    (): string | null => useTerminalStore.getState().addPane(featureId),
    [featureId],
  );
  const removePane = useCallback(
    (paneId: string) => useTerminalStore.getState().removePane(featureId, paneId),
    [featureId],
  );
  const minimize = useCallback(() => useTerminalStore.getState().minimize(featureId), [featureId]);
  const closePanel = useCallback(
    () => useTerminalStore.getState().closePanel(featureId),
    [featureId],
  );

  return {
    ...state,
    panes,
    togglePanel,
    splitPane,
    addPane,
    removePane,
    minimize,
    closePanel,
  };
}
