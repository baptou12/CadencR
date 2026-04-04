import { useEffect, useRef, useCallback, useState } from "react";
import { EditorView, lineNumbers, highlightActiveLine, drawSelection, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { vim } from "@replit/codemirror-vim";
import { markdown } from "@codemirror/lang-markdown";
import { useGetFeatureArtifact, useUpdateFeatureArtifact } from "@/api/generated";
import { useEditorStore } from "@/stores/editor-store";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { cadenceEditorTheme } from "@/components/editor/editor-theme";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { Badge } from "@/components/ui/badge";
import { FileTextIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

interface ArtifactEditorProps {
  featureId: number;
  phaseSlug: string;
  paneId: string;
  filePath: string;
}

const AUTO_SAVE_DELAY_MS = 500;

export default function ArtifactEditor({ featureId, phaseSlug, paneId, filePath }: ArtifactEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSavedVisible, setAutoSavedVisible] = useState(false);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localContentRef = useRef<string | null>(null);
  const hasPendingEditsRef = useRef(false);

  const { value: vimModeSetting } = useDebouncedSetting("editor_vim_mode");
  const isVimEnabled = (vimModeSetting ?? "false") === "true";

  const setDirty = useEditorStore((s) => s.setDirty);
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition);
  const cursorPosition = useEditorStore(
    (s) => s.features[featureId]?.panes[paneId]?.tabs.find((t) => t.filePath === filePath)?.cursorPosition ?? { line: 1, col: 1 },
  );

  const phaseStatus = useWorkflowStore((s) => s.phaseStates.get(phaseSlug)?.status);
  const isReadOnly = phaseStatus === "running";

  const { data: artifact, isLoading, error } = useGetFeatureArtifact(featureId, phaseSlug, {
    enabled: Boolean(featureId && phaseSlug),
    refetchOnWindowFocus: false,
  });

  const updateArtifact = useUpdateFeatureArtifact();
  const mutateAsyncRef = useRef(updateArtifact.mutateAsync);
  mutateAsyncRef.current = updateArtifact.mutateAsync;

  const saveContent = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !mutateAsyncRef.current) return;
    const content = view.state.doc.toString();
    try {
      await mutateAsyncRef.current({ featureId, phaseSlug, content });
      setDirty(featureId, paneId, filePath, false);
      hasPendingEditsRef.current = false;
      localContentRef.current = content;
      setAutoSavedVisible(true);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
      autoSavedTimerRef.current = setTimeout(() => setAutoSavedVisible(false), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save artifact";
      toast.error(msg);
    }
  }, [featureId, phaseSlug, paneId, filePath, setDirty]);

  // Swap vim mode
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: vimCompartmentRef.current.reconfigure(isVimEnabled ? vim() : []) });
  }, [isVimEnabled]);

  // Toggle read-only
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(isReadOnly)) });
  }, [isReadOnly]);

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setDirty(featureId, paneId, filePath, true);
        hasPendingEditsRef.current = true;
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => { void saveContent(); }, AUTO_SAVE_DELAY_MS);
      }
      if (update.selectionSet) {
        const cursor = update.state.selection.main.head;
        const line = update.state.doc.lineAt(cursor);
        setCursorPosition(featureId, paneId, filePath, { line: line.number, col: cursor - line.from + 1 });
      }
    });

    const saveKeymap = keymap.of([{ key: "Mod-s", run: () => { void saveContent(); return true; } }]);

    const extensions = [
      history(),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      bracketMatching(),
      indentOnInput(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      saveKeymap,
      updateListener,
      vimCompartmentRef.current.of(isVimEnabled ? vim() : []),
      readOnlyCompartmentRef.current.of(EditorState.readOnly.of(isReadOnly)),
      ...cadenceEditorTheme,
      markdown(),
    ];

    const state = EditorState.create({ doc: "", extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    view.focus();

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Load artifact content into editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !artifact) return;

    const serverContent = artifact.content;

    // If user has pending edits and server content changed, show notification
    if (hasPendingEditsRef.current && localContentRef.current !== null && serverContent !== localContentRef.current) {
      toast("Artifact updated by agent", {
        description: "Reload to see the latest version?",
        action: {
          label: "Reload",
          onClick: () => {
            const v = viewRef.current;
            if (!v) return;
            v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: serverContent } });
            setDirty(featureId, paneId, filePath, false);
            hasPendingEditsRef.current = false;
            localContentRef.current = serverContent;
          },
        },
      });
      return;
    }

    const currentContent = view.state.doc.toString();
    if (currentContent !== serverContent) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: serverContent } });
      setDirty(featureId, paneId, filePath, false);
      localContentRef.current = serverContent;
    }
  }, [artifact, filePath, featureId, paneId, setDirty]);

  const overlay = isLoading ? (
    <div className="absolute inset-0 flex items-center justify-center z-10 bg-background">
      <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
    </div>
  ) : error ? (
    <div className="absolute inset-0 flex items-center justify-center z-10 bg-background text-destructive text-sm px-6 text-center">
      {error instanceof Error ? error.message : "Failed to load artifact"}
    </div>
  ) : null;

  return (
    <div className="h-full flex flex-col relative">
      {overlay}
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <FileTextIcon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground truncate">{phaseSlug}</span>
        <Badge variant="outline" className="text-[9px] px-1 py-0">Artifact</Badge>
        {isReadOnly && <Badge variant="outline" className="text-[9px] px-1 py-0 text-yellow-400">Read-only</Badge>}
        {artifact?.updated_at && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Updated {new Date(artifact.updated_at).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto" />
      <div className="flex items-center justify-between px-3 py-0.5 border-t border-border bg-card text-xs text-muted-foreground shrink-0">
        <span>Ln {cursorPosition.line}, Col {cursorPosition.col}</span>
        <div className="flex items-center gap-3">
          {autoSavedVisible && <span>Auto-saved</span>}
          <span>Markdown</span>
        </div>
      </div>
    </div>
  );
}
