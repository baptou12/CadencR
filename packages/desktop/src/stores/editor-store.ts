import { create } from "zustand";
import type { EditorStore } from "./editor-store-types";
import { createEditorTabActions } from "./editor-tab-actions";
import { createEditorPaneActions } from "./editor-pane-actions";
import { createEditorConflictActions } from "./editor-conflict-actions";

// Public API surface — re-exported so consumers keep importing from
// `@/stores/editor-store`. The implementation is split across sibling
// modules to satisfy the 400-line file cap; the store itself just composes
// the tab- and pane-action slices below.
export { DEFAULT_MAX_TABS, UNTITLED_PATH_PREFIX, isUntitledPath } from "./editor-store-types";
export type {
  SplitOrientation,
  Direction,
  EditorLeaf,
  EditorSplit,
  EditorSplitNode,
} from "./editor-store-types";
export { defaultFeatureState } from "./editor-helpers";

export const useEditorStore = create<EditorStore>((set, get) => ({
  features: {},
  ...createEditorTabActions(set, get),
  ...createEditorConflictActions(set),
  ...createEditorPaneActions(set),
}));
