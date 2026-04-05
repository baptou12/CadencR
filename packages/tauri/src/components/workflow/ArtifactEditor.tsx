import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { DEFAULT_ARTIFACT_TYPE, useGetFeatureArtifact, useGetTypedArtifact, useUpdateFeatureArtifact, useUpdateTypedArtifact } from "@/api/generated";
import { useEditorStore } from "@/stores/editor-store";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import BaseCodeMirrorEditor from "@/components/editor/BaseCodeMirrorEditor";
import { Badge } from "@/components/ui/badge";
import { FileTextIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

interface ArtifactEditorProps {
  featureId: number;
  phaseSlug: string;
  paneId: string;
  filePath: string;
  artifactType?: string;
}

const AUTO_SAVE_DELAY_MS = 500;
const MARKDOWN_LANG = markdown();

export default function ArtifactEditor({ featureId, phaseSlug, paneId, filePath, artifactType }: ArtifactEditorProps) {
  const isTyped = Boolean(artifactType && artifactType !== DEFAULT_ARTIFACT_TYPE);
  const viewRef = useRef<EditorView | null>(null);
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

  const defaultQuery = useGetFeatureArtifact(featureId, phaseSlug, {
    enabled: Boolean(featureId && phaseSlug && !isTyped),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const typedQuery = useGetTypedArtifact(featureId, phaseSlug, artifactType ?? DEFAULT_ARTIFACT_TYPE, {
    enabled: Boolean(featureId && phaseSlug && isTyped),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const { data: artifact, isLoading, error } = isTyped ? typedQuery : defaultQuery;

  const defaultMutation = useUpdateFeatureArtifact();
  const typedMutation = useUpdateTypedArtifact();

  const saveContent = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    try {
      if (isTyped) {
        await typedMutation.mutateAsync({ featureId, phaseSlug, artifactType: artifactType!, content });
      } else {
        await defaultMutation.mutateAsync({ featureId, phaseSlug, content });
      }
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
  }, [featureId, phaseSlug, paneId, filePath, setDirty, isTyped, artifactType]);

  const handleSave = useCallback(() => { void saveContent(); }, [saveContent]);

  const handleChange = useCallback((_value: string) => {
    setDirty(featureId, paneId, filePath, true);
    hasPendingEditsRef.current = true;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => { void saveContent(); }, AUTO_SAVE_DELAY_MS);
  }, [featureId, paneId, filePath, setDirty, saveContent]);

  // Cursor tracking extension (stable across renders)
  const cursorExtension = useMemo(() => {
    return EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const cursor = update.state.selection.main.head;
        const line = update.state.doc.lineAt(cursor);
        setCursorPosition(featureId, paneId, filePath, { line: line.number, col: cursor - line.from + 1 });
      }
    });
  }, [featureId, paneId, filePath, setCursorPosition]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
    };
  }, []);

  // Load artifact content into editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !artifact) return;

    const serverContent = artifact.content;

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
        <span className="text-xs font-medium text-foreground truncate">{isTyped ? `${phaseSlug}/${artifactType}` : phaseSlug}</span>
        <Badge variant="outline" className="text-[9px] px-1 py-0">Artifact</Badge>
        {isReadOnly && <Badge variant="outline" className="text-[9px] px-1 py-0 text-yellow-400">Read-only</Badge>}
        {artifact?.updated_at && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Updated {new Date(artifact.updated_at).toLocaleTimeString()}
          </span>
        )}
      </div>
      <BaseCodeMirrorEditor
        language={MARKDOWN_LANG}
        vimMode={isVimEnabled}
        readOnly={isReadOnly}
        onChange={handleChange}
        onSave={handleSave}
        extraExtensions={[cursorExtension]}
        editorViewRef={viewRef}
        className="flex-1 overflow-auto"
      />
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
