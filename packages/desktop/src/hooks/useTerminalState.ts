import { useCallback, useMemo } from "react";
import { create, type StateCreator } from "zustand";
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
  /**
   * Hydrate an empty feature with panes bound to PTYs already running on the
   * backend, so a second device (e.g. a remote browser) attaches to the live
   * shells instead of spawning new ones. No-op if the feature already has a
   * pane tree, keeping it idempotent against StrictMode/double-invoke.
   */
  adoptPtys: (featureId: number, ptys: Array<{ ptyId: string; cwd?: string }>) => void;
  removePane: (featureId: number, paneId: string) => void;
  /**
   * Replace a leaf in-place with a fresh empty leaf (new id, no ptyId).
   * The tree structure is preserved so split layouts survive a restart.
   * The caller is responsible for having killed the old PTY. An optional
   * `notice` is shown as a display-only line once the new PTY is ready.
   */
  replaceLeafWithFresh: (featureId: number, paneId: string, notice?: string) => void;
  minimize: (featureId: number) => void;
  closePanel: (featureId: number) => void;
  setPtyId: (featureId: number, paneId: string, ptyId: string) => void;
  setPaneCwd: (featureId: number, paneId: string, cwd: string) => void;
  dismissCwdWarning: (featureId: number, paneId: string) => void;
  sendToTerminal: (featureId: number, command: string) => void;
  clearInitialCommand: (featureId: number, paneId: string) => void;
  clearInitialNotice: (featureId: number, paneId: string) => void;
}

function updateFeature(
  state: { features: Record<number, TerminalPanelState> },
  featureId: number,
  next: TerminalPanelState,
): { features: Record<number, TerminalPanelState> } {
  return { features: { ...state.features, [featureId]: next } };
}

type TerminalStoreSet = Parameters<StateCreator<TerminalStore>>[0];
type TerminalStoreGet = Parameters<StateCreator<TerminalStore>>[1];

function createPanelActions(
  set: TerminalStoreSet,
  get: TerminalStoreGet,
): Pick<TerminalStore, "getFeature" | "togglePanel" | "minimize" | "closePanel"> {
  return {
    getFeature: (featureId) => get().features[featureId] ?? defaultState,
    togglePanel: (featureId) =>
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        if (!previous.root) {
          return updateFeature(state, featureId, {
            isOpen: true,
            isMinimized: false,
            root: makeLeaf(),
          });
        }
        return updateFeature(state, featureId, {
          ...previous,
          isOpen: !previous.isOpen,
          isMinimized: false,
        });
      }),
    minimize: (featureId) =>
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        return updateFeature(state, featureId, { ...previous, isMinimized: true });
      }),
    closePanel: (featureId) => set((state) => updateFeature(state, featureId, { ...defaultState })),
  };
}

function createLayoutActions(
  set: TerminalStoreSet,
): Pick<
  TerminalStore,
  "splitPane" | "addPane" | "adoptPtys" | "removePane" | "replaceLeafWithFresh"
> {
  return {
    splitPane: (featureId, leafId, orientation) => {
      let createdId: string | null = null;
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        if (!previous.root) {
          const newLeaf = makeLeaf();
          createdId = newLeaf.id;
          return updateFeature(state, featureId, {
            isOpen: true,
            isMinimized: false,
            root: newLeaf,
          });
        }
        const targetId = leafId ?? getLeaves(previous.root).at(-1)?.id;
        if (!targetId) return state;
        const newLeaf = makeLeaf();
        createdId = newLeaf.id;
        return updateFeature(state, featureId, {
          ...previous,
          root: splitLeaf(previous.root, targetId, orientation, newLeaf),
        });
      });
      return createdId;
    },
    addPane: (featureId) => {
      let createdId: string | null = null;
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        if (!previous.root) {
          const newLeaf = makeLeaf();
          createdId = newLeaf.id;
          return updateFeature(state, featureId, { ...previous, root: newLeaf });
        }
        const lastLeaf = getLeaves(previous.root).at(-1);
        if (!lastLeaf) return state;
        const newLeaf = makeLeaf();
        createdId = newLeaf.id;
        return updateFeature(state, featureId, {
          ...previous,
          root: splitLeaf(previous.root, lastLeaf.id, "horizontal", newLeaf),
        });
      });
      return createdId;
    },
    adoptPtys: (featureId, ptys) =>
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        if (previous.root || ptys.length === 0) return state;
        let root: SplitNode = makeLeaf({ ptyId: ptys[0].ptyId, cwd: ptys[0].cwd });
        for (let index = 1; index < ptys.length; index += 1) {
          const target = getLeaves(root).at(-1);
          if (!target) break;
          root = splitLeaf(root, target.id, "horizontal", makeLeaf(ptys[index]));
        }
        return updateFeature(state, featureId, { isOpen: true, isMinimized: false, root });
      }),
    removePane: (featureId, paneId) =>
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        if (!previous.root) return state;
        const root = removeLeaf(previous.root, paneId);
        return updateFeature(
          state,
          featureId,
          root ? { ...previous, root } : { isOpen: false, isMinimized: false, root: null },
        );
      }),
    replaceLeafWithFresh: (featureId, paneId, notice) =>
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        if (!previous.root) return state;
        const root = replaceLeaf(previous.root, paneId, makeLeaf({ initialNotice: notice }));
        return root === previous.root
          ? state
          : updateFeature(state, featureId, { ...previous, root });
      }),
  };
}

function createPaneMetadataActions(
  set: TerminalStoreSet,
): Pick<
  TerminalStore,
  "setPtyId" | "setPaneCwd" | "dismissCwdWarning" | "clearInitialCommand" | "clearInitialNotice"
> {
  const updatePane = (
    featureId: number,
    paneId: string,
    update: (leaf: TerminalLeaf) => TerminalLeaf,
    skipIfUnchanged = true,
  ): void =>
    set((state) => {
      const previous = state.features[featureId] ?? defaultState;
      if (!previous.root) return state;
      const root = updateLeaf(previous.root, paneId, update);
      return skipIfUnchanged && root === previous.root
        ? state
        : updateFeature(state, featureId, { ...previous, root });
    });
  return {
    setPtyId: (featureId, paneId, ptyId) =>
      updatePane(featureId, paneId, (leaf) => (leaf.ptyId === ptyId ? leaf : { ...leaf, ptyId })),
    setPaneCwd: (featureId, paneId, cwd) =>
      updatePane(featureId, paneId, (leaf) => (leaf.cwd === cwd ? leaf : { ...leaf, cwd })),
    dismissCwdWarning: (featureId, paneId) =>
      updatePane(
        featureId,
        paneId,
        (leaf) => (leaf.cwdWarningDismissed ? leaf : { ...leaf, cwdWarningDismissed: true }),
        false,
      ),
    clearInitialCommand: (featureId, paneId) =>
      updatePane(featureId, paneId, (leaf) => ({ ...leaf, initialCommand: undefined }), false),
    clearInitialNotice: (featureId, paneId) =>
      updatePane(featureId, paneId, (leaf) =>
        leaf.initialNotice === undefined ? leaf : { ...leaf, initialNotice: undefined },
      ),
  };
}

function createTerminalCommandActions(
  set: TerminalStoreSet,
): Pick<TerminalStore, "sendToTerminal"> {
  return {
    sendToTerminal: (featureId, command) =>
      set((state) => {
        const previous = state.features[featureId] ?? defaultState;
        const newLeaf = makeLeaf({ initialCommand: command });
        if (!previous.root) {
          return updateFeature(state, featureId, {
            isOpen: true,
            isMinimized: false,
            root: newLeaf,
          });
        }
        const lastLeaf = getLeaves(previous.root).at(-1);
        if (!lastLeaf) return state;
        return updateFeature(state, featureId, {
          ...previous,
          isOpen: true,
          isMinimized: false,
          root: splitLeaf(previous.root, lastLeaf.id, "horizontal", newLeaf),
        });
      }),
  };
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  features: {},
  ...createPanelActions(set, get),
  ...createLayoutActions(set),
  ...createPaneMetadataActions(set),
  ...createTerminalCommandActions(set),
}));

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useTerminalState(featureId: number) {
  // Subscribe only to this feature's slice. Actions are read via getState()
  // so the consumer doesn't re-render on every store mutation.
  const state = useTerminalStore((s) => s.getFeature(featureId));

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

  return useMemo(
    () => ({
      ...state,
      panes: getPanes(state),
      togglePanel,
      splitPane,
      addPane,
      removePane,
      minimize,
      closePanel,
    }),
    [state, togglePanel, splitPane, addPane, removePane, minimize, closePanel],
  );
}
