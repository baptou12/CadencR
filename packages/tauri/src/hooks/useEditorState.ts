import { useCallback } from "react";

import {
  type Direction,
  type SplitOrientation,
  defaultFeatureState,
  useEditorStore,
} from "@/stores/editor-store";

export function useEditorState(featureId: number) {
  const state = useEditorStore((s) => s.features[featureId] ?? defaultFeatureState);
  const store = useEditorStore();

  const initFeature = useCallback(() => store.initFeature(featureId), [store, featureId]);
  const openFile = useCallback(
    (paneId: string, filePath: string, maxTabs?: number) =>
      store.openFile(featureId, paneId, filePath, maxTabs),
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
    (paneId: string, filePath: string, isDirty: boolean) =>
      store.setDirty(featureId, paneId, filePath, isDirty),
    [store, featureId],
  );
  const setCursorPosition = useCallback(
    (paneId: string, filePath: string, pos: { line: number; col: number }) =>
      store.setCursorPosition(featureId, paneId, filePath, pos),
    [store, featureId],
  );
  const toggleSidebar = useCallback(() => store.toggleSidebar(featureId), [store, featureId]);
  const splitEditorPane = useCallback(
    (paneId: string, orientation: SplitOrientation) =>
      store.splitEditorPane(featureId, paneId, orientation),
    [store, featureId],
  );
  const removeEditorPane = useCallback(
    (paneId: string) => store.removeEditorPane(featureId, paneId),
    [store, featureId],
  );
  const navigatePane = useCallback(
    (direction: Direction) => store.navigatePane(featureId, direction),
    [store, featureId],
  );
  const setActivePane = useCallback(
    (paneId: string) => store.setActivePane(featureId, paneId),
    [store, featureId],
  );

  return {
    ...state,
    initFeature,
    openFile,
    closeTab,
    setActiveFile,
    setDirty,
    setCursorPosition,
    toggleSidebar,
    splitEditorPane,
    removeEditorPane,
    navigatePane,
    setActivePane,
  };
}
