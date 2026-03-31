import { useCallback } from "react";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorTab {
  filePath: string;
  fileName: string;
  disambiguatedName: string;
  isDirty: boolean;
  cursorPosition: { line: number; col: number };
}

export interface EditorPaneState {
  tabs: EditorTab[];
  activeFilePath: string | null;
}

export interface EditorFeatureState {
  panes: Record<string, EditorPaneState>;
  activePaneId: string;
  sidebarVisible: boolean;
}

// Default max tabs — can be overridden via settings in the component layer
export const DEFAULT_MAX_TABS = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PANE_ID = "main";

const defaultPaneState: EditorPaneState = {
  tabs: [],
  activeFilePath: null,
};

const defaultFeatureState: EditorFeatureState = {
  panes: { [DEFAULT_PANE_ID]: { ...defaultPaneState } },
  activePaneId: DEFAULT_PANE_ID,
  sidebarVisible: true,
};

function getFileName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

/** Compute disambiguated names for all tabs in a pane.
 *  If two tabs share a file name, include the parent directory. */
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EditorStore {
  features: Record<number, EditorFeatureState>;

  initFeature: (featureId: number) => void;
  openFile: (featureId: number, paneId: string, filePath: string, maxTabs?: number) => void;
  closeTab: (featureId: number, paneId: string, filePath: string) => void;
  setActiveFile: (featureId: number, paneId: string, filePath: string) => void;
  setDirty: (featureId: number, paneId: string, filePath: string, isDirty: boolean) => void;
  setCursorPosition: (featureId: number, paneId: string, filePath: string, pos: { line: number; col: number }) => void;
  toggleSidebar: (featureId: number) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  features: {},

  initFeature: (featureId) => {
    if (get().features[featureId]) return;
    set((state) => updateFeature(state, featureId, { ...defaultFeatureState, panes: { [DEFAULT_PANE_ID]: { ...defaultPaneState } } }));
  },

  openFile: (featureId, paneId, filePath, maxTabs = DEFAULT_MAX_TABS) =>
    set((state) => {
      const feature = state.features[featureId] ?? { ...defaultFeatureState };
      const next = updatePane(feature, paneId, (pane) => {
        // Already open — just focus
        if (pane.tabs.some((t) => t.filePath === filePath)) {
          return { ...pane, activeFilePath: filePath };
        }

        const fileName = getFileName(filePath);
        const newTab: EditorTab = {
          filePath,
          fileName,
          disambiguatedName: fileName,
          isDirty: false,
          cursorPosition: { line: 1, col: 1 },
        };

        let tabs = [...pane.tabs, newTab];

        // Enforce max tabs: close oldest non-dirty tab if needed
        if (tabs.length > maxTabs) {
          const oldestNonDirtyIdx = tabs.findIndex((t) => !t.isDirty);
          if (oldestNonDirtyIdx !== -1) {
            tabs = tabs.filter((_, i) => i !== oldestNonDirtyIdx);
          }
          // If all dirty, allow exceeding temporarily
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
          // Activate adjacent tab
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
}));

// ---------------------------------------------------------------------------
// Convenience hook
// ---------------------------------------------------------------------------

export function useEditorState(featureId: number) {
  const state = useEditorStore((s) => s.features[featureId] ?? defaultFeatureState);
  const store = useEditorStore();

  const initFeature = useCallback(() => store.initFeature(featureId), [store, featureId]);
  const openFile = useCallback(
    (paneId: string, filePath: string, maxTabs?: number) => store.openFile(featureId, paneId, filePath, maxTabs),
    [store, featureId],
  );
  const closeTab = useCallback(
    (paneId: string, filePath: string) => store.closeTab(featureId, paneId, filePath),
    [store, featureId],
  );
  const setActiveFile = useCallback(
    (paneId: string, filePath: string) => store.setActiveFile(featureId, paneId, filePath),
    [store, featureId],
  );
  const setDirty = useCallback(
    (paneId: string, filePath: string, isDirty: boolean) => store.setDirty(featureId, paneId, filePath, isDirty),
    [store, featureId],
  );
  const setCursorPosition = useCallback(
    (paneId: string, filePath: string, pos: { line: number; col: number }) =>
      store.setCursorPosition(featureId, paneId, filePath, pos),
    [store, featureId],
  );
  const toggleSidebar = useCallback(() => store.toggleSidebar(featureId), [store, featureId]);

  return { ...state, initFeature, openFile, closeTab, setActiveFile, setDirty, setCursorPosition, toggleSidebar };
}
