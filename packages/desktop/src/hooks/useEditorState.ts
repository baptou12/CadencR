import { useCallback, useMemo } from "react";

import {
  type Direction,
  type SplitOrientation,
  defaultFeatureState,
  useEditorStore,
} from "@/stores/editor-store";

export function useEditorState(featureId: number) {
  const state = useEditorStore((s) => s.features[featureId] ?? defaultFeatureState);

  const initFeature = useCallback(
    () => useEditorStore.getState().initFeature(featureId),
    [featureId],
  );
  const openFile = useCallback(
    (paneId: string, filePath: string, maxTabs?: number, goToLine?: number) =>
      useEditorStore.getState().openFile(featureId, paneId, filePath, maxTabs, goToLine),
    [featureId],
  );
  const closeTab = useCallback(
    (paneId: string, filePath: string) =>
      useEditorStore.getState().closeTab(featureId, paneId, filePath),
    [featureId],
  );
  const setActiveFile = useCallback(
    (paneId: string, filePath: string) =>
      useEditorStore.getState().setActiveFile(featureId, paneId, filePath),
    [featureId],
  );
  const renameFilePath = useCallback(
    (oldPath: string, newPath: string) =>
      useEditorStore.getState().renameFilePath(featureId, oldPath, newPath),
    [featureId],
  );
  const setDirty = useCallback(
    (paneId: string, filePath: string, isDirty: boolean) =>
      useEditorStore.getState().setDirty(featureId, paneId, filePath, isDirty),
    [featureId],
  );
  const setCursorPosition = useCallback(
    (paneId: string, filePath: string, pos: { line: number; col: number }) =>
      useEditorStore.getState().setCursorPosition(featureId, paneId, filePath, pos),
    [featureId],
  );
  const toggleSidebar = useCallback(
    () => useEditorStore.getState().toggleSidebar(featureId),
    [featureId],
  );
  const splitEditorPane = useCallback(
    (paneId: string, orientation: SplitOrientation) =>
      useEditorStore.getState().splitEditorPane(featureId, paneId, orientation),
    [featureId],
  );
  const removeEditorPane = useCallback(
    (paneId: string) => useEditorStore.getState().removeEditorPane(featureId, paneId),
    [featureId],
  );
  const navigatePane = useCallback(
    (direction: Direction) => useEditorStore.getState().navigatePane(featureId, direction),
    [featureId],
  );
  const setActivePane = useCallback(
    (paneId: string) => useEditorStore.getState().setActivePane(featureId, paneId),
    [featureId],
  );

  return useMemo(
    () => ({
      ...state,
      initFeature,
      openFile,
      closeTab,
      setActiveFile,
      renameFilePath,
      setDirty,
      setCursorPosition,
      toggleSidebar,
      splitEditorPane,
      removeEditorPane,
      navigatePane,
      setActivePane,
    }),
    [
      state,
      initFeature,
      openFile,
      closeTab,
      setActiveFile,
      renameFilePath,
      setDirty,
      setCursorPosition,
      toggleSidebar,
      splitEditorPane,
      removeEditorPane,
      navigatePane,
      setActivePane,
    ],
  );
}
