import { useCallback, useMemo, useRef, type MutableRefObject, type ReactElement } from "react";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { unifiedMergeView } from "@codemirror/merge";
import BaseCodeMirrorEditor from "./BaseCodeMirrorEditor";
import { conflictResolutionControls } from "./conflict-resolution-extension";
import type {
  ConflictChoice,
  ConflictHunk,
  MappedConflictHunk,
} from "./conflict-resolution-adapter";

interface ConflictUnifiedEditorProps {
  initialContent: string;
  currentLabel: string;
  incomingLabel: string;
  hunks: ConflictHunk[];
  language: Extension | null;
  vimMode: boolean;
  viewRef: MutableRefObject<EditorView | null>;
  onChange: () => void;
  onSave: () => void;
  onApply: (hunk: MappedConflictHunk, choice: ConflictChoice) => void;
  onEditorViewChange: (view: EditorView | null) => void;
}

export default function ConflictUnifiedEditor(props: ConflictUnifiedEditorProps): ReactElement {
  const initialSourceRef = useRef(props.initialContent);
  const notifyEditorViewChange = props.onEditorViewChange;
  const extraExtensions = useMemo(
    () => [
      unifiedMergeView({
        original: initialSourceRef.current,
        mergeControls: false,
        allowInlineDiffs: true,
        diffConfig: { scanLimit: 500, timeout: 100 },
      }),
      conflictResolutionControls({
        hunks: props.hunks,
        currentLabel: props.currentLabel,
        incomingLabel: props.incomingLabel,
        onApply: props.onApply,
      }),
      EditorView.contentAttributes.of({ "aria-label": "Writable Result" }),
      conflictUnifiedTheme,
    ],
    [props.currentLabel, props.hunks, props.incomingLabel, props.onApply],
  );
  const handleViewChange = useCallback(
    (nextView: EditorView | null): void => {
      notifyEditorViewChange(nextView);
    },
    [notifyEditorViewChange],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden" aria-label="Writable Result">
      <BaseCodeMirrorEditor
        initialContent={props.initialContent}
        language={props.language}
        vimMode={props.vimMode}
        onChange={props.onChange}
        onSave={props.onSave}
        editorViewRef={props.viewRef}
        onEditorViewChange={handleViewChange}
        extraExtensions={extraExtensions}
        className="h-full overflow-hidden"
      />
    </div>
  );
}

const conflictUnifiedTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": { overflow: "auto" },
  ".cm-deletedChunk": {
    borderInlineStart: "4px solid color-mix(in srgb, var(--acc-red) 86%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--acc-red) 18%, var(--code-bg))",
  },
  ".cm-changedLine": {
    boxShadow: "inset 4px 0 0 color-mix(in srgb, var(--acc-green) 86%, transparent)",
    backgroundColor: "color-mix(in srgb, var(--acc-green) 18%, var(--code-bg))",
  },
  ".cm-changedText": {
    background: "color-mix(in srgb, var(--acc-green) 38%, transparent)",
    textDecoration: "none",
  },
  ".cm-deletedText": {
    background: "color-mix(in srgb, var(--acc-red) 36%, transparent)",
    textDecoration: "none",
  },
});
