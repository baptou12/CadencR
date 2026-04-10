import { create } from "zustand";
import { DEFAULT_ARTIFACT_TYPE } from "@/api/generated";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SplitOrientation = "horizontal" | "vertical";
export type Direction = "left" | "right" | "up" | "down";

interface EditorTab {
  filePath: string;
  fileName: string;
  disambiguatedName: string;
  isDirty: boolean;
  cursorPosition: { line: number; col: number };
  /** When set, the editor scrolls to this line on next load and clears it. */
  pendingGoToLine?: number;
  isArtifact?: boolean;
  artifactFeatureId?: number;
  artifactPhaseSlug?: string;
  artifactType?: string;
}

interface EditorPaneState {
  tabs: EditorTab[];
  activeFilePath: string | null;
}

export type EditorLeaf = { type: "leaf"; id: string };
export type EditorSplit = {
  type: "split";
  orientation: SplitOrientation;
  children: [EditorSplitNode, EditorSplitNode];
};
export type EditorSplitNode = EditorLeaf | EditorSplit;

interface EditorFeatureState {
  splitTree: EditorSplitNode;
  panes: Record<string, EditorPaneState>;
  activePaneId: string;
  sidebarVisible: boolean;
}

// Default max tabs — can be overridden via settings in the component layer
export const DEFAULT_MAX_TABS = 10;

// ---------------------------------------------------------------------------
// Split tree helpers
// ---------------------------------------------------------------------------

function getEditorLeaves(node: EditorSplitNode): EditorLeaf[] {
  if (node.type === "leaf") return [node];
  return [...getEditorLeaves(node.children[0]), ...getEditorLeaves(node.children[1])];
}

function splitLeaf(
  node: EditorSplitNode,
  leafId: string,
  orientation: SplitOrientation,
  newLeaf: EditorLeaf,
): EditorSplitNode {
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

function removeLeaf(node: EditorSplitNode, leafId: string): EditorSplitNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }
  const [a, b] = node.children;
  const newA = removeLeaf(a, leafId);
  if (newA === null) return b;
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = removeLeaf(b, leafId);
  if (newB === null) return a;
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

// ---------------------------------------------------------------------------
// Spatial navigation helpers
// ---------------------------------------------------------------------------

interface PathStep {
  node: EditorSplit;
  childIndex: 0 | 1;
}

function directionAxis(dir: Direction): SplitOrientation {
  return dir === "left" || dir === "right" ? "horizontal" : "vertical";
}

function findPathToLeaf(node: EditorSplitNode, leafId: string): PathStep[] | null {
  if (node.type === "leaf") return node.id === leafId ? [] : null;
  for (const idx of [0, 1] as const) {
    const result = findPathToLeaf(node.children[idx], leafId);
    if (result !== null) return [{ node, childIndex: idx }, ...result];
  }
  return null;
}

function nearestLeafOnEdge(node: EditorSplitNode, dir: Direction): string {
  if (node.type === "leaf") return node.id;
  const axis = directionAxis(dir);
  if (node.orientation === axis) {
    const pick = dir === "left" || dir === "up" ? 1 : 0;
    return nearestLeafOnEdge(node.children[pick], dir);
  }
  return nearestLeafOnEdge(node.children[0], dir);
}

function findAdjacentEditorLeaf(
  root: EditorSplitNode,
  leafId: string,
  direction: Direction,
): string | null {
  const path = findPathToLeaf(root, leafId);
  if (!path) return null;
  const axis = directionAxis(direction);
  const departingIndex: 0 | 1 = direction === "left" || direction === "up" ? 1 : 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i];
    if (step.node.orientation === axis && step.childIndex === departingIndex) {
      const otherChild = step.node.children[departingIndex === 1 ? 0 : 1];
      return nearestLeafOnEdge(otherChild, direction);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pane state helpers
// ---------------------------------------------------------------------------

const DEFAULT_PANE_ID = "main";

const defaultPaneState: EditorPaneState = {
  tabs: [],
  activeFilePath: null,
};

const defaultSplitTree: EditorSplitNode = { type: "leaf", id: DEFAULT_PANE_ID };

export const defaultFeatureState: EditorFeatureState = {
  splitTree: defaultSplitTree,
  panes: { [DEFAULT_PANE_ID]: { ...defaultPaneState } },
  activePaneId: DEFAULT_PANE_ID,
  sidebarVisible: true,
};

function getFileName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

/** Compute disambiguated names for all tabs in a pane. */
function disambiguateTabNames(tabs: EditorTab[]): EditorTab[] {
  const nameCounts = new Map<string, number>();
  for (const t of tabs) {
    nameCounts.set(t.fileName, (nameCounts.get(t.fileName) ?? 0) + 1);
  }
  return tabs.map((t) => {
    if ((nameCounts.get(t.fileName) ?? 0) > 1) {
      const parts = t.filePath.split("/");
      const disambig = parts.length >= 2 ? `${parts.at(-2)}/${t.fileName}` : t.fileName;
      return { ...t, disambiguatedName: disambig };
    }
    return { ...t, disambiguatedName: t.fileName };
  });
}

function updatePane(
  feature: EditorFeatureState,
  paneId: string,
  updater: (pane: EditorPaneState) => EditorPaneState,
): EditorFeatureState {
  const pane = feature.panes[paneId] ?? { ...defaultPaneState };
  return { ...feature, panes: { ...feature.panes, [paneId]: updater(pane) } };
}

function updateFeature(
  state: { features: Record<number, EditorFeatureState> },
  featureId: number,
  next: EditorFeatureState,
): { features: Record<number, EditorFeatureState> } {
  return { features: { ...state.features, [featureId]: next } };
}

function nextPaneId(): string {
  return `editor-pane-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EditorStore {
  features: Record<number, EditorFeatureState>;

  initFeature: (featureId: number) => void;
  openFile: (featureId: number, paneId: string, filePath: string, maxTabs?: number, goToLine?: number) => void;
  closeTab: (featureId: number, paneId: string, filePath: string) => void;
  setActiveFile: (featureId: number, paneId: string, filePath: string) => void;
  setDirty: (featureId: number, paneId: string, filePath: string, isDirty: boolean) => void;
  setCursorPosition: (
    featureId: number,
    paneId: string,
    filePath: string,
    pos: { line: number; col: number },
  ) => void;
  toggleSidebar: (featureId: number) => void;
  splitEditorPane: (featureId: number, paneId: string, orientation: SplitOrientation) => void;
  removeEditorPane: (featureId: number, paneId: string) => void;
  navigatePane: (featureId: number, direction: Direction) => void;
  setActivePane: (featureId: number, paneId: string) => void;
  openArtifact: (featureId: number, paneId: string, phaseSlug: string, maxTabs?: number, artifactType?: string) => void;
  openPhaseArtifacts: (featureId: number, paneId: string, phaseSlug: string, artifactTypes: string[], maxTabs?: number) => void;
  clearPendingGoToLine: (featureId: number, paneId: string, filePath: string) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  features: {},

  initFeature: (featureId) => {
    if (get().features[featureId]) return;
    set((state) =>
      updateFeature(state, featureId, {
        ...defaultFeatureState,
        splitTree: { type: "leaf", id: DEFAULT_PANE_ID },
        panes: { [DEFAULT_PANE_ID]: { ...defaultPaneState } },
      }),
    );
  },

  openFile: (featureId, paneId, filePath, maxTabs = DEFAULT_MAX_TABS, goToLine?) =>
    set((state) => {
      const feature = state.features[featureId] ?? { ...defaultFeatureState };
      const next = updatePane(feature, paneId, (pane) => {
        if (pane.tabs.some((t) => t.filePath === filePath)) {
          // File already open — update pendingGoToLine if specified
          const tabs = goToLine
            ? pane.tabs.map((t) => t.filePath === filePath ? { ...t, pendingGoToLine: goToLine } : t)
            : pane.tabs;
          return { ...pane, tabs, activeFilePath: filePath };
        }

        const fileName = getFileName(filePath);
        const newTab: EditorTab = {
          filePath,
          fileName,
          disambiguatedName: fileName,
          isDirty: false,
          cursorPosition: { line: goToLine ?? 1, col: 1 },
          pendingGoToLine: goToLine,
        };

        let tabs = [...pane.tabs, newTab];

        if (tabs.length > maxTabs) {
          const oldestNonDirtyIdx = tabs.findIndex((t) => !t.isDirty);
          if (oldestNonDirtyIdx !== -1) {
            tabs = tabs.filter((_, i) => i !== oldestNonDirtyIdx);
          }
        }

        return { tabs: disambiguateTabNames(tabs), activeFilePath: filePath };
      });
      return updateFeature(state, featureId, next);
    }),

  closeTab: (featureId, paneId, filePath) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      const next = updatePane(feature, paneId, (pane) => {
        const idx = pane.tabs.findIndex((t) => t.filePath === filePath);
        if (idx === -1) return pane;
        const tabs = disambiguateTabNames(pane.tabs.filter((t) => t.filePath !== filePath));
        let activeFilePath = pane.activeFilePath;
        if (activeFilePath === filePath) {
          activeFilePath = tabs[Math.max(0, idx - 1)]?.filePath ?? tabs[0]?.filePath ?? null;
        }
        return { tabs, activeFilePath };
      });
      return updateFeature(state, featureId, next);
    }),

  setActiveFile: (featureId, paneId, filePath) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      const next = updatePane(feature, paneId, (pane) => ({ ...pane, activeFilePath: filePath }));
      return updateFeature(state, featureId, next);
    }),

  setDirty: (featureId, paneId, filePath, isDirty) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      const next = updatePane(feature, paneId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((t) => (t.filePath === filePath ? { ...t, isDirty } : t)),
      }));
      return updateFeature(state, featureId, next);
    }),

  setCursorPosition: (featureId, paneId, filePath, pos) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      const next = updatePane(feature, paneId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((t) => (t.filePath === filePath ? { ...t, cursorPosition: pos } : t)),
      }));
      return updateFeature(state, featureId, next);
    }),

  toggleSidebar: (featureId) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      return updateFeature(state, featureId, { ...feature, sidebarVisible: !feature.sidebarVisible });
    }),

  splitEditorPane: (featureId, paneId, orientation) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      const newLeaf: EditorLeaf = { type: "leaf", id: nextPaneId() };
      const newTree = splitLeaf(feature.splitTree, paneId, orientation, newLeaf);
      const newPanes = { ...feature.panes, [newLeaf.id]: { ...defaultPaneState } };
      return updateFeature(state, featureId, {
        ...feature,
        splitTree: newTree,
        panes: newPanes,
        activePaneId: newLeaf.id,
      });
    }),

  removeEditorPane: (featureId, paneId) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;

      // Don't remove the last pane
      const leaves = getEditorLeaves(feature.splitTree);
      if (leaves.length <= 1) return state;

      const newTree = removeLeaf(feature.splitTree, paneId);
      if (!newTree) return state;

      // Clean up pane state
      const newPanes = { ...feature.panes };
      delete newPanes[paneId];

      // If active pane was removed, pick the first remaining leaf
      let newActivePaneId = feature.activePaneId;
      if (newActivePaneId === paneId) {
        newActivePaneId = getEditorLeaves(newTree)[0]?.id ?? feature.activePaneId;
      }

      return updateFeature(state, featureId, {
        ...feature,
        splitTree: newTree,
        panes: newPanes,
        activePaneId: newActivePaneId,
      });
    }),

  navigatePane: (featureId, direction) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      const adjacent = findAdjacentEditorLeaf(feature.splitTree, feature.activePaneId, direction);
      if (!adjacent) return state;
      return updateFeature(state, featureId, { ...feature, activePaneId: adjacent });
    }),

  setActivePane: (featureId, paneId) =>
    set((state) => {
      const feature = state.features[featureId];
      if (!feature) return state;
      return updateFeature(state, featureId, { ...feature, activePaneId: paneId });
    }),

  openArtifact: (featureId, paneId, phaseSlug, maxTabs = DEFAULT_MAX_TABS, artifactType) =>
    set((state) => {
      const typeSuffix = artifactType && artifactType !== DEFAULT_ARTIFACT_TYPE ? `/${artifactType}` : "";
      const filePath = `artifact://${featureId}/${phaseSlug}${typeSuffix}`;
      const displayName = artifactType && artifactType !== DEFAULT_ARTIFACT_TYPE
        ? `${phaseSlug}/${artifactType} (Artifact)`
        : `${phaseSlug} (Artifact)`;
      const feature = state.features[featureId] ?? { ...defaultFeatureState };
      const next = updatePane(feature, paneId, (pane) => {
        if (pane.tabs.some((t) => t.filePath === filePath)) {
          return { ...pane, activeFilePath: filePath };
        }
        const newTab: EditorTab = {
          filePath,
          fileName: displayName,
          disambiguatedName: displayName,
          isDirty: false,
          cursorPosition: { line: 1, col: 1 },
          isArtifact: true,
          artifactFeatureId: featureId,
          artifactPhaseSlug: phaseSlug,
          artifactType,
        };
        let tabs = [...pane.tabs, newTab];
        if (tabs.length > maxTabs) {
          const oldestNonDirtyIdx = tabs.findIndex((t) => !t.isDirty);
          if (oldestNonDirtyIdx !== -1) {
            tabs = tabs.filter((_, i) => i !== oldestNonDirtyIdx);
          }
        }
        return { tabs: disambiguateTabNames(tabs), activeFilePath: filePath };
      });
      return updateFeature(state, featureId, next);
    }),

  openPhaseArtifacts: (featureId, paneId, phaseSlug, artifactTypes, maxTabs = DEFAULT_MAX_TABS) => {
    const { openArtifact } = get();
    for (const at of artifactTypes) {
      openArtifact(featureId, paneId, phaseSlug, maxTabs, at);
    }
    // Re-activate the first type (openArtifact leaves the last one active)
    if (artifactTypes.length > 1) {
      openArtifact(featureId, paneId, phaseSlug, maxTabs, artifactTypes[0]);
    }
  },

  clearPendingGoToLine: (featureId, paneId, filePath) =>
    set((state) => {
      const feature = state.features[featureId] ?? { ...defaultFeatureState };
      const next = updatePane(feature, paneId, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((t) =>
          t.filePath === filePath ? { ...t, pendingGoToLine: undefined } : t,
        ),
      }));
      return updateFeature(state, featureId, next);
    }),
}));

