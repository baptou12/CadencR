import { useEffect, useRef } from "react";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  keymap,
} from "@codemirror/view";
import { EditorState, Compartment, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import { cadencrEditorTheme } from "./editor-theme";

interface BaseCodeMirrorEditorProps {
  /** Initial document content (only used on mount) */
  initialContent?: string;
  /** CodeMirror language extension (e.g. markdown(), getLanguageExtension()) */
  language?: Extension | null;
  /** Toggle read-only mode (hot-swappable) */
  readOnly?: boolean;
  /** Toggle vim mode (hot-swappable) */
  vimMode?: boolean;
  /** Called on every doc change — callers own debounce */
  onChange?: (value: string) => void;
  /** Mod-s handler */
  onSave?: () => void;
  /** Additional extensions (cursor tracking, etc.) */
  extraExtensions?: Extension[];
  className?: string;
  /** Escape hatch for direct EditorView access */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
}

export default function BaseCodeMirrorEditor({
  initialContent = "",
  language,
  readOnly = false,
  vimMode = false,
  onChange,
  onSave,
  extraExtensions,
  className = "h-full overflow-auto",
  editorViewRef,
}: BaseCodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());

  // Store callbacks in refs to avoid stale closures
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Sync EditorView to caller's ref
  useEffect(() => {
    if (editorViewRef) editorViewRef.current = viewRef.current;
  });

  // Hot-swap vim mode
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: vimCompartment.current.reconfigure(vimMode ? vim() : []) });
  }, [vimMode]);

  // Hot-swap readOnly
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  // Hot-swap language
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: languageCompartment.current.reconfigure(language ?? []) });
  }, [language]);

  // Create editor once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      history(),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveKeymap,
      updateListener,
      vimCompartment.current.of(vimMode ? vim() : []),
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      languageCompartment.current.of(language ?? []),
      ...cadencrEditorTheme,
      ...(extraExtensions ?? []),
    ];

    const state = EditorState.create({ doc: initialContent, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    if (editorViewRef) editorViewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
      if (editorViewRef) editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={className} />;
}
