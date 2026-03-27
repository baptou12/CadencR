import { useCallback } from "react";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Split tree types — supports nested horizontal/vertical splits like iTerm2
// ---------------------------------------------------------------------------

export type SplitOrientation = "horizontal" | "vertical";

/** A leaf node represents a single terminal pane */
export interface TerminalLeaf {
  type: "leaf";
  id: string;
  ptyId?: string;
  initialCommand?: string;
}

/** A split node contains two children arranged in a given orientation */
export interface TerminalSplit {
  type: "split";
  orientation: SplitOrientation;
  children: [SplitNode, SplitNode];
}

export type SplitNode = TerminalLeaf | TerminalSplit;

/** Flat pane info exposed to callers that don't need the tree structure */
export interface TerminalPane {
  id: string;
  ptyId?: string;
  initialCommand?: string;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

/** Collect all leaves in DFS order (left-to-right, top-to-bottom) */
export function getLeaves(node: SplitNode): TerminalLeaf[] {
  if (node.type === "leaf") return [node];
  return [...getLeaves(node.children[0]), ...getLeaves(node.children[1])];
}

/** Replace a leaf with a split containing the original + a new leaf */
function splitLeaf(node: SplitNode, leafId: string, orientation: SplitOrientation, newLeaf: TerminalLeaf): SplitNode {
  if (node.type === "leaf") {
    if (node.id === leafId) {
      return { type: "split", orientation, children: [node, newLeaf] };
    }
    return node;
  }
  const [a, b] = node.children;
  const newA = splitLeaf(a, leafId, orientation, newLeaf);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = splitLeaf(b, leafId, orientation, newLeaf);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

/** Remove a leaf and collapse its parent split. Returns null if the tree is now empty. */
function removeLeaf(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }
  const [a, b] = node.children;
  const newA = removeLeaf(a, leafId);
  if (newA === null) return b; // leaf was in left branch — promote right
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = removeLeaf(b, leafId);
  if (newB === null) return a; // leaf was in right branch — promote left
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

/** Update a leaf's fields by id */
function updateLeaf(node: SplitNode, leafId: string, updater: (leaf: TerminalLeaf) => TerminalLeaf): SplitNode {
  if (node.type === "leaf") {
    return node.id === leafId ? updater(node) : node;
  }
  const [a, b] = node.children;
  const newA = updateLeaf(a, leafId, updater);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = updateLeaf(b, leafId, updater);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
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
  /** Split the active pane (by leafId) in the given orientation. If no leafId, splits the last leaf. */
  splitPane: (featureId: number, leafId: string | undefined, orientation: SplitOrientation) => void;
  /** Add a pane (no specific split target — appends to last leaf). Used for simple "new pane" actions. */
  addPane: (featureId: number) => void;
  removePane: (featureId: number, paneId: string) => void;
  minimize: (featureId: number) => void;
  closePanel: (featureId: number) => void;
  setPtyId: (featureId: number, paneId: string, ptyId: string) => void;
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
        return updateFeature(state, featureId, { isOpen: true, isMinimized: false, root: makeLeaf() });
      }
      if (prev.isOpen) {
        return updateFeature(state, featureId, { ...prev, isOpen: false, isMinimized: false });
      }
      return updateFeature(state, featureId, { ...prev, isOpen: true, isMinimized: false });
    }),

  splitPane: (featureId, leafId, orientation) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) {
        return updateFeature(state, featureId, { isOpen: true, isMinimized: false, root: makeLeaf() });
      }
      const targetId = leafId ?? getLeaves(prev.root).at(-1)?.id;
      if (!targetId) return state;
      const newLeaf = makeLeaf();
      const newRoot = splitLeaf(prev.root, targetId, orientation, newLeaf);
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

  addPane: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) {
        return updateFeature(state, featureId, { ...prev, root: makeLeaf() });
      }
      // Default: vertical split on the last leaf
      const lastLeaf = getLeaves(prev.root).at(-1);
      if (!lastLeaf) return state;
      const newLeaf = makeLeaf();
      const newRoot = splitLeaf(prev.root, lastLeaf.id, "horizontal", newLeaf);
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),

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

  minimize: (featureId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      return updateFeature(state, featureId, { ...prev, isMinimized: true });
    }),

  closePanel: (featureId) =>
    set((state) => updateFeature(state, featureId, { ...defaultState })),

  setPtyId: (featureId, paneId, ptyId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = updateLeaf(prev.root, paneId, (leaf) => ({ ...leaf, ptyId }));
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
      return updateFeature(state, featureId, { ...prev, isOpen: true, isMinimized: false, root: newRoot });
    }),

  clearInitialCommand: (featureId, paneId) =>
    set((state) => {
      const prev = state.features[featureId] ?? defaultState;
      if (!prev.root) return state;
      const newRoot = updateLeaf(prev.root, paneId, (leaf) => ({ ...leaf, initialCommand: undefined }));
      return updateFeature(state, featureId, { ...prev, root: newRoot });
    }),
}));

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useTerminalState(featureId: number) {
  const state = useTerminalStore((s) => s.getFeature(featureId));
  const store = useTerminalStore();

  const panes = getPanes(state);
  const togglePanel = useCallback(() => store.togglePanel(featureId), [store, featureId]);
  const splitPane = useCallback(
    (leafId: string | undefined, orientation: SplitOrientation) => store.splitPane(featureId, leafId, orientation),
    [store, featureId],
  );
  const addPane = useCallback(() => store.addPane(featureId), [store, featureId]);
  const removePane = useCallback((paneId: string) => store.removePane(featureId, paneId), [store, featureId]);
  const minimize = useCallback(() => store.minimize(featureId), [store, featureId]);
  const closePanel = useCallback(() => store.closePanel(featureId), [store, featureId]);

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
