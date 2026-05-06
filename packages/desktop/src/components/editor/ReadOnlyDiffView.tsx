import { useEffect, useRef } from "react";
import { EditorView, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { cadencrDiffExtensions } from "./editor-theme";
import { getCadencrDiffConfig } from "./diff-config";
import { getLanguageExtension } from "./language-extensions";

interface ReadOnlyDiffViewProps {
  oldContent: string;
  newContent: string;
  /** File path used for language detection */
  filePath: string;
  mode: "unified" | "split";
  className?: string;
  /** Additional CodeMirror extensions (e.g. comment decorations) */
  extraExtensions?: Extension[];
  /** Escape hatch: exposes the "new content" EditorView (unified) or editor B (split) */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
}

/** Shared read-only extensions for both diff modes */
function baseExtensions(filePath: string, extra?: Extension[]): Extension[] {
  const lang = getLanguageExtension(filePath);
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    lineNumbers(),
    drawSelection(),
    ...cadencrDiffExtensions,
    ...(lang ? [lang] : []),
    ...(extra ?? []),
  ];
}

/**
 * Read-only diff viewer backed by CodeMirror.
 * Supports unified (single editor with inline changes) and split (side-by-side) modes.
 */
export function ReadOnlyDiffView({
  oldContent,
  newContent,
  filePath,
  mode,
  className = "h-full overflow-auto",
  extraExtensions,
  editorViewRef,
}: ReadOnlyDiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);
  const unifiedViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    // Clear previous view
    mergeViewRef.current?.destroy();
    mergeViewRef.current = null;
    unifiedViewRef.current?.destroy();
    unifiedViewRef.current = null;
    if (editorViewRef) editorViewRef.current = null;

    const container = containerRef.current;
    const extensions = baseExtensions(filePath, extraExtensions);
    const diffConfig = getCadencrDiffConfig(oldContent, newContent);
    const mergeOptions = {
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
      ...(diffConfig ? { diffConfig } : {}),
    };

    if (mode === "split") {
      const mv = new MergeView({
        a: {
          doc: oldContent,
          extensions,
        },
        b: {
          doc: newContent,
          extensions,
        },
        parent: container,
        ...mergeOptions,
      });
      mergeViewRef.current = mv;
      if (editorViewRef) editorViewRef.current = mv.b;
    } else {
      const view = new EditorView({
        state: EditorState.create({
          doc: newContent,
          extensions: [
            ...extensions,
            unifiedMergeView({
              original: oldContent,
              ...mergeOptions,
              syntaxHighlightDeletions: true,
              mergeControls: false,
            }),
          ],
        }),
        parent: container,
      });
      unifiedViewRef.current = view;
      if (editorViewRef) editorViewRef.current = view;
    }

    return () => {
      mergeViewRef.current?.destroy();
      mergeViewRef.current = null;
      unifiedViewRef.current?.destroy();
      unifiedViewRef.current = null;
      if (editorViewRef) editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldContent, newContent, filePath, mode, extraExtensions]);

  return <div ref={containerRef} className={`cm-mergeView ${className}`} />;
}
