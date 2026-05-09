import { create } from "zustand";

import {
  EMPTY_LAYOUT_STATE,
  flatLayoutState,
  ROOT_LEAF_ID,
  type FeatureLayoutState,
  type LayoutLeaf,
  type LayoutNode,
  type LayoutSplit,
  type SplitOrientation,
  type TabKind,
} from "./feature-layout-schema";

/**
 * Per-feature layout state, keyed by feature id. Modeled after `editor-store.ts`
 * (binary split tree) but with a *list* of tabs per leaf so multiple tabs can
 * share a pane (VSCode-style).
 *
 * Truth rules:
 *  - `splitRoot` is never null. It always contains a leaf with id ROOT_LEAF_ID.
 *  - A tab lives in exactly one leaf at a time.
 *  - A non-root leaf with empty `tabIds` collapses to its sibling.
 *  - The root leaf may be empty (placeholder strip in the UI).
 */

// ---------------------------------------------------------------------------
// Tree helpers (mirrors patterns from editor-store.ts)
// ---------------------------------------------------------------------------

export type SplitEdge = "top" | "right" | "bottom" | "left";
export type SplitPath = ReadonlyArray<0 | 1>;

export function getLeaves(node: LayoutNode): LayoutLeaf[] {
  if (node.type === "leaf") return [node];
  return [...getLeaves(node.children[0]), ...getLeaves(node.children[1])];
}

export function findLeafById(node: LayoutNode, leafId: string): LayoutLeaf | null {
  if (node.type === "leaf") return node.id === leafId ? node : null;
  return findLeafById(node.children[0], leafId) ?? findLeafById(node.children[1], leafId);
}

export function findPaneContaining(node: LayoutNode, tab: TabKind): LayoutLeaf | null {
  if (node.type === "leaf") return node.tabIds.includes(tab) ? node : null;
  return findPaneContaining(node.children[0], tab) ?? findPaneContaining(node.children[1], tab);
}

function edgeToSplit(edge: SplitEdge): { orientation: SplitOrientation; newAtIndex: 0 | 1 } {
  switch (edge) {
    case "top":
      return { orientation: "vertical", newAtIndex: 0 };
    case "bottom":
      return { orientation: "vertical", newAtIndex: 1 };
    case "left":
      return { orientation: "horizontal", newAtIndex: 0 };
    case "right":
      return { orientation: "horizontal", newAtIndex: 1 };
  }
}

function splitLeafAt(
  node: LayoutNode,
  targetLeafId: string,
  edge: SplitEdge,
  newLeaf: LayoutLeaf,
): LayoutNode {
  if (node.type === "leaf") {
    if (node.id !== targetLeafId) return node;
    const { orientation, newAtIndex } = edgeToSplit(edge);
    const children: [LayoutNode, LayoutNode] = newAtIndex === 0 ? [newLeaf, node] : [node, newLeaf];
    return { type: "split", orientation, children };
  }
  const [a, b] = node.children;
  const newA = splitLeafAt(a, targetLeafId, edge, newLeaf);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = splitLeafAt(b, targetLeafId, edge, newLeaf);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

/**
 * Remove a leaf by id; collapses parent split when one side empties.
 * The root leaf is *kept* even when empty — caller code must not pass it
 * as a removal target.
 */
function removeLeafById(node: LayoutNode, leafId: string): LayoutNode {
  if (node.type === "leaf") {
    // We never reach here with the root id (caller guards), but be defensive.
    return node;
  }
  const [a, b] = node.children;
  if (a.type === "leaf" && a.id === leafId) return b;
  if (b.type === "leaf" && b.id === leafId) return a;
  const newA = removeLeafById(a, leafId);
  const newB = removeLeafById(b, leafId);
  if (newA === a && newB === b) return node;
  return { ...node, children: [newA, newB] };
}

function mapLeaf(
  node: LayoutNode,
  leafId: string,
  fn: (leaf: LayoutLeaf) => LayoutLeaf,
): LayoutNode {
  if (node.type === "leaf") return node.id === leafId ? fn(node) : node;
  const [a, b] = node.children;
  const newA = mapLeaf(a, leafId, fn);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = mapLeaf(b, leafId, fn);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

function mapSplitsAtPath(
  node: LayoutNode,
  path: SplitPath,
  depth: number,
  fn: (split: LayoutSplit) => LayoutSplit,
): LayoutNode {
  if (node.type === "leaf") return node;
  if (depth === path.length) return fn(node);
  const idx = path[depth];
  const child = node.children[idx];
  const newChild = mapSplitsAtPath(child, path, depth + 1, fn);
  if (newChild === child) return node;
  const newChildren: [LayoutNode, LayoutNode] = [...node.children];
  newChildren[idx] = newChild;
  return { ...node, children: newChildren };
}

function makeLeaf(tabs: TabKind[], active: TabKind): LayoutLeaf {
  return {
    type: "leaf",
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    tabIds: tabs,
    activeTabId: active,
  };
}

/**
 * Strip a tab from the entire tree. Non-root leaves collapse when empty.
 * The root leaf stays (possibly empty).
 */
function pluckTab(root: LayoutNode, tab: TabKind): LayoutNode {
  const containing = findPaneContaining(root, tab);
  if (containing === null) return root;
  const remainingTabs = containing.tabIds.filter((t) => t !== tab);
  if (remainingTabs.length === 0 && containing.id !== ROOT_LEAF_ID) {
    return removeLeafById(root, containing.id);
  }
  return mapLeaf(root, containing.id, (leaf) => {
    const nextActive: TabKind | null =
      leaf.activeTabId === tab ? (remainingTabs[0] ?? null) : leaf.activeTabId;
    return { ...leaf, tabIds: remainingTabs, activeTabId: nextActive };
  });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface FeatureLayoutStore {
  features: Record<number, FeatureLayoutState>;
  // ---- bootstrap / replace ----
  setState(featureId: number, state: FeatureLayoutState): void;
  resetToFlat(featureId: number): void;
  ensureInitialized(featureId: number): FeatureLayoutState;
  // ---- moves ----
  /** Drag a tab onto a pane edge; creates a new sibling pane next to `targetPaneId`. */
  splitTabAt(featureId: number, tab: TabKind, targetPaneId: string, edge: SplitEdge): void;
  /** Drop a tab into an existing pane (center drop or strip insertion). */
  moveTabToPane(featureId: number, tab: TabKind, targetPaneId: string, index?: number): void;
  /** Convenience: move a tab back to the root pane's strip. */
  dockTab(featureId: number, tab: TabKind, index?: number): void;
  /** Set which tab is shown inside a pane's strip. */
  setPaneActiveTab(featureId: number, paneId: string, tab: TabKind): void;
  // ---- resize ----
  setSplitSizes(featureId: number, splitPath: SplitPath, sizes: [number, number]): void;
  // ---- focus ----
  setFocusedPane(featureId: number, paneId: string | null): void;
  // ---- saved layouts metadata ----
  setAppliedLayoutId(featureId: number, layoutId: number | null): void;
}

function update(
  set: (fn: (s: FeatureLayoutStore) => Partial<FeatureLayoutStore>) => void,
  featureId: number,
  fn: (state: FeatureLayoutState) => FeatureLayoutState,
): void {
  set((s) => {
    const current = s.features[featureId] ?? flatLayoutState();
    const next = fn(current);
    // No-op: the action computed an identical state. Skip the features-map
    // rebuild so consumers subscribed via selectors don't rerender.
    if (next === current) return s;
    return { features: { ...s.features, [featureId]: next } };
  });
}

export const useFeatureLayoutStore = create<FeatureLayoutStore>((set, get) => ({
  features: {},

  setState: (featureId, state) => set((s) => ({ features: { ...s.features, [featureId]: state } })),

  resetToFlat: (featureId) =>
    set((s) => ({ features: { ...s.features, [featureId]: flatLayoutState() } })),

  ensureInitialized: (featureId) => {
    const existing = get().features[featureId];
    if (existing) return existing;
    const initial = flatLayoutState();
    set((s) => ({ features: { ...s.features, [featureId]: initial } }));
    return initial;
  },

  splitTabAt: (featureId, tab, targetPaneId, edge) =>
    update(set, featureId, (st) => {
      const after = pluckTab(st.splitRoot, tab);
      // Target may have collapsed if it was the source's empty sibling.
      const targetExists = findLeafById(after, targetPaneId) !== null;
      const newLeaf = makeLeaf([tab], tab);
      let splitRoot: LayoutNode;
      if (targetExists) {
        splitRoot = splitLeafAt(after, targetPaneId, edge, newLeaf);
      } else if (after.type === "leaf") {
        splitRoot = splitLeafAt(after, after.id, edge, newLeaf);
      } else {
        // Fall back to splitting the leftmost leaf so the user sees *something*.
        splitRoot = splitLeafAt(after, getFirstLeafId(after), edge, newLeaf);
      }
      return { ...st, splitRoot, focusedPaneId: newLeaf.id };
    }),

  moveTabToPane: (featureId, tab, targetPaneId, index) =>
    update(set, featureId, (st) => {
      const after = pluckTab(st.splitRoot, tab);
      const target = findLeafById(after, targetPaneId);
      if (!target) return st; // target collapsed; bail (caller already handled fallback if needed)
      const splitRoot = mapLeaf(after, targetPaneId, (leaf) => {
        const at = index ?? leaf.tabIds.length;
        const tabIds = [...leaf.tabIds];
        tabIds.splice(at, 0, tab);
        return { ...leaf, tabIds, activeTabId: tab };
      });
      return { ...st, splitRoot, focusedPaneId: targetPaneId };
    }),

  dockTab: (featureId, tab, index) => get().moveTabToPane(featureId, tab, ROOT_LEAF_ID, index),

  setPaneActiveTab: (featureId, paneId, tab) =>
    update(set, featureId, (st) => {
      const splitRoot = mapLeaf(st.splitRoot, paneId, (leaf) =>
        leaf.tabIds.includes(tab) && leaf.activeTabId !== tab
          ? { ...leaf, activeTabId: tab }
          : leaf,
      );
      // Skip the rebuild entirely if neither the active tab nor focus changed.
      if (splitRoot === st.splitRoot && st.focusedPaneId === paneId) return st;
      return { ...st, splitRoot, focusedPaneId: paneId };
    }),

  setSplitSizes: (featureId, splitPath, sizes) =>
    update(set, featureId, (st) => {
      const splitRoot = mapSplitsAtPath(st.splitRoot, splitPath, 0, (split) => ({
        ...split,
        sizes,
      }));
      return { ...st, splitRoot };
    }),

  setFocusedPane: (featureId, paneId) =>
    update(set, featureId, (st) =>
      st.focusedPaneId === paneId ? st : { ...st, focusedPaneId: paneId },
    ),

  setAppliedLayoutId: (featureId, layoutId) =>
    update(set, featureId, (st) => ({ ...st, appliedLayoutId: layoutId })),
}));

function getFirstLeafId(node: LayoutNode): string {
  return node.type === "leaf" ? node.id : getFirstLeafId(node.children[0]);
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectFeatureLayout(featureId: number) {
  // CAUTION: must return a referentially stable value when the feature isn't
  // hydrated yet — otherwise Zustand sees a new object on every render and
  // triggers an infinite re-render loop in any consumer reading the whole
  // state (or any nested object like `.splitRoot`).
  return (s: FeatureLayoutStore): FeatureLayoutState => s.features[featureId] ?? EMPTY_LAYOUT_STATE;
}

/** Pane id that hosts the given tab, or `null` if the tab isn't placed yet. */
export function findHostFor(state: FeatureLayoutState, tab: TabKind): string | null {
  return findPaneContaining(state.splitRoot, tab)?.id ?? null;
}

export function activateFeatureTab(featureId: number, tab: TabKind): boolean {
  const state = useFeatureLayoutStore.getState().features[featureId];
  if (!state) return false;
  const paneId = findHostFor(state, tab);
  if (!paneId) return false;
  useFeatureLayoutStore.getState().setPaneActiveTab(featureId, paneId, tab);
  return true;
}

/** Pane whose active tab should be treated as globally focused. */
export function getFocusedLeaf(state: FeatureLayoutState): LayoutLeaf | null {
  const focusedLeaf = state.focusedPaneId
    ? findLeafById(state.splitRoot, state.focusedPaneId)
    : null;
  return (
    focusedLeaf ??
    findLeafById(state.splitRoot, ROOT_LEAF_ID) ??
    getLeaves(state.splitRoot)[0] ??
    null
  );
}

/** The single globally focused tab, falling back to the root pane's active tab. */
export function getFocusedTab(state: FeatureLayoutState): TabKind | null {
  return getFocusedLeaf(state)?.activeTabId ?? null;
}

/** Whether the given tab is currently visible (it's the host pane's active tab). */
export function isTabVisible(state: FeatureLayoutState, tab: TabKind): boolean {
  const leaf = findPaneContaining(state.splitRoot, tab);
  return leaf?.activeTabId === tab;
}
