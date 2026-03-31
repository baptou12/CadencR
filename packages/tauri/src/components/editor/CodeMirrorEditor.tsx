import { useEffect, useRef, useCallback, useState } from "react";
import { EditorView, lineNumbers, highlightActiveLine, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import { useReadFile, useWriteFile } from "@/api/generated";
import { useEditorStore } from "@/stores/editor-store";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { cadenceEditorTheme } from "./editor-theme";
import { getLanguageExtension } from "./language-extensions";
import { toast } from "sonner";

interface CodeMirrorEditorProps {
  filePath: string;
  projectPath: string;
  paneId: string;
  featureId: number;
}

const MAX_LINES = 10_000;

const AUTO_SAVE_DELAY_MS = 1500;

export default function CodeMirrorEditor({ filePath, projectPath, paneId, featureId }: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartmentRef = useRef(new Compartment());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSavedVisible, setAutoSavedVisible] = useState(false);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { value: vimModeSetting } = useDebouncedSetting("editor_vim_mode");
  const { value: autoSaveSetting } = useDebouncedSetting("editor_auto_save");
  const isVimEnabled = (vimModeSetting ?? "false") === "true";
  const isAutoSaveEnabled = (autoSaveSetting ?? "false") === "true";
  const isAutoSaveEnabledRef = useRef(isAutoSaveEnabled);
  isAutoSaveEnabledRef.current = isAutoSaveEnabled;

  const setDirty = useEditorStore((s) => s.setDirty);
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition);

  const { data, isLoading, error } = useReadFile(
    { projectPath, filePath },
    { enabled: Boolean(filePath && projectPath) },
  );

  const writeFile = useWriteFile();

  const saveQuiet = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    try {
      await writeFile.mutateAsync({ project_path: projectPath, file_path: filePath, content });
      setDirty(featureId, paneId, filePath, false);
      setAutoSavedVisible(true);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
      autoSavedTimerRef.current = setTimeout(() => setAutoSavedVisible(false), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to auto-save file";
      toast.error(msg);
    }
  }, [writeFile, projectPath, filePath, featureId, paneId, setDirty]);

  const save = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    try {
      await writeFile.mutateAsync({ project_path: projectPath, file_path: filePath, content });
      setDirty(featureId, paneId, filePath, false);
      toast.success("File saved");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save file";
      toast.error(msg);
    }
  }, [writeFile, projectPath, filePath, featureId, paneId, setDirty]);

  // Swap vim extension in/out without recreating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: vimCompartmentRef.current.reconfigure(isVimEnabled ? vim() : []),
    });
  }, [isVimEnabled]);

  // Build or rebuild the editor when content is loaded
  useEffect(() => {
    if (!containerRef.current || !data) return;

    const langExt = getLanguageExtension(filePath);
    const vimCompartment = vimCompartmentRef.current;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setDirty(featureId, paneId, filePath, true);
        if (isAutoSaveEnabledRef.current) {
          if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = setTimeout(() => { void saveQuiet(); }, AUTO_SAVE_DELAY_MS);
        }
      }
      if (update.selectionSet) {
        const cursor = update.state.selection.main.head;
        const line = update.state.doc.lineAt(cursor);
        setCursorPosition(featureId, paneId, filePath, {
          line: line.number,
          col: cursor - line.from + 1,
        });
      }
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          void save();
          return true;
        },
      },
    ]);

    const extensions = [
      history(),
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveKeymap,
      updateListener,
      vimCompartment.of(isVimEnabled ? vim() : []),
      ...cadenceEditorTheme,
      ...(langExt ? [langExt] : []),
    ];

    const state = EditorState.create({ doc: data.content, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // Rebuild only when file changes; save is stable via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filePath]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4 h-full animate-pulse">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : "Failed to load file";
    const isTooLarge = data && "line_count" in data && (data as { line_count: number }).line_count > MAX_LINES;
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm px-6 text-center">
        {isTooLarge ? `File exceeds ${MAX_LINES.toLocaleString()} lines and cannot be displayed.` : message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Select a file to open
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      <div ref={containerRef} className="flex-1 overflow-auto" />
      {autoSavedVisible && (
        <div className="absolute bottom-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded pointer-events-none">
          Auto-saved
        </div>
      )}
    </div>
  );
}
