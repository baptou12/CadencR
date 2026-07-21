import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import type { EditorView } from "@codemirror/view";
import { Loader2Icon } from "lucide-react";
import type { ConflictContentSnapshot } from "@/api/generated";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useEditorLanguage } from "@/hooks/useEditorLanguage";
import { useEditorStore } from "@/stores/editor-store";
import ConflictUnifiedEditor from "./ConflictUnifiedEditor";
import { getLanguageExtension } from "./language-extensions";
import { registerSave, unregisterSave } from "./editorSaveRegistry";
import { useEditorFormat } from "./useEditorFormat";
import { useEditorSave } from "./useEditorSave";
import { conflictSourceLabels, textFromConflictContent } from "./ConflictResolverSurface";
import {
  applyConflictChoice,
  buildConflictHunks,
  type ConflictChoice,
  type MappedConflictHunk,
} from "./conflict-resolution-adapter";
const AUTO_SAVE_DELAY_MS = 1500;

interface ConflictResultResolverProps {
  featureId: number;
  paneId: string;
  projectId: number;
  filePath: string;
  snapshot: ConflictContentSnapshot;
  onEditorViewChange?: (paneId: string, view: EditorView | null) => void;
}

export default function ConflictResultResolver(props: ConflictResultResolverProps): ReactElement {
  const resultContent = textFromConflictContent(props.snapshot.result) ?? "";
  const editor = useConflictResultEditor({ ...props, resultContent });
  const labels = useMemo(
    () => conflictSourceLabels(props.snapshot.operation),
    [props.snapshot.operation],
  );
  // One writable Result view, edited like any file. The conflict regions and
  // per-hunk actions live inline in CodeMirror — no toolbar, header, or footer.
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <ConflictUnifiedEditor
        initialContent={resultContent}
        currentLabel={labels.stage2}
        incomingLabel={labels.stage3}
        hunks={editor.hunks}
        language={editor.languageExtension}
        vimMode={editor.vimEnabled}
        viewRef={editor.viewRef}
        onChange={editor.onChange}
        onSave={editor.onSave}
        onApply={editor.onApply}
        onEditorViewChange={editor.onViewChange}
      />
      <ConflictEditorStatus isSaving={editor.isSaving} saveError={editor.saveError} />
      <p className="sr-only" aria-live="polite">
        {editor.announcement}
      </p>
    </div>
  );
}

function ConflictEditorStatus({
  isSaving,
  saveError,
}: {
  isSaving: boolean;
  saveError: string | null;
}): ReactElement | null {
  if (!isSaving && !saveError) return null;
  return (
    <div
      className="absolute bottom-2 right-3 z-10 flex items-center gap-1.5 rounded border border-border bg-popover px-2 py-1 text-xs shadow-md"
      role={saveError ? "alert" : "status"}
    >
      {isSaving && <Loader2Icon className="size-3 animate-spin" aria-hidden />}
      <span className={saveError ? "text-destructive" : "text-muted-foreground"}>
        {saveError ?? "Saving…"}
      </span>
    </div>
  );
}

function useConflictResultEditor({
  featureId,
  paneId,
  projectId,
  filePath,
  snapshot,
  resultContent,
  onEditorViewChange,
}: ConflictResultResolverProps & { resultContent: string }) {
  const viewRef = useRef<EditorView | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapping = useConflictHunkMappings({
    paneId,
    snapshot,
    resultContent,
    viewRef,
    onEditorViewChange,
    enabled: snapshot.presentation.mode !== "guidance",
  });
  const setDirty = useEditorStore((state) => state.setDirty);
  const language = useEditorLanguage(projectId, filePath);
  const { value: vimSetting } = useDebouncedSetting("editor_vim_mode");
  const { value: autoSaveSetting } = useDebouncedSetting("editor_auto_save");
  const { beforeWrite } = useEditorFormat({
    projectId,
    featureId,
    filePath,
    viewRef,
    largeMode: false,
  });
  const saveState = useEditorSave({
    projectId,
    featureId,
    paneId,
    filePath,
    content: resultContent,
    viewRef,
    beforeWrite,
  });
  const autoSaveEnabledRef = useRef((autoSaveSetting ?? "false") === "true");
  autoSaveEnabledRef.current = (autoSaveSetting ?? "false") === "true";

  const onChange = useCallback((): void => {
    setDirty(featureId, paneId, filePath, true);
    if (!autoSaveEnabledRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => void saveState.saveQuiet(), AUTO_SAVE_DELAY_MS);
  }, [featureId, filePath, paneId, saveState.saveQuiet, setDirty]);
  const onSave = useCallback((): void => {
    void saveState.save();
  }, [saveState.save]);
  const languageExtension = useMemo(
    () => getLanguageExtension(filePath, language.languageId),
    [filePath, language.languageId],
  );

  useConflictSaveRegistration(paneId, filePath, saveState.save, autoSaveTimerRef);

  return useMemo(
    () => ({
      viewRef,
      hunks: mapping.hunks,
      onApply: mapping.onApply,
      onChange,
      onSave,
      onViewChange: mapping.onViewChange,
      announcement: mapping.announcement,
      isSaving: saveState.isSaving,
      saveError: saveState.errorMessage,
      vimEnabled: (vimSetting ?? "false") === "true",
      languageExtension,
    }),
    [
      languageExtension,
      mapping,
      onChange,
      onSave,
      saveState.errorMessage,
      saveState.isSaving,
      vimSetting,
    ],
  );
}

function useConflictSaveRegistration(
  paneId: string,
  filePath: string,
  save: () => Promise<void>,
  autoSaveTimerRef: RefObject<ReturnType<typeof setTimeout> | null>,
): void {
  useEffect(() => {
    registerSave(paneId, filePath, save);
    return () => unregisterSave(paneId, filePath);
  }, [filePath, paneId, save]);
  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    },
    [autoSaveTimerRef],
  );
}

function useConflictHunkMappings({
  paneId,
  snapshot,
  resultContent,
  viewRef,
  onEditorViewChange,
  enabled,
}: Pick<ConflictResultResolverProps, "paneId" | "snapshot" | "onEditorViewChange"> & {
  resultContent: string;
  viewRef: RefObject<EditorView | null>;
  enabled: boolean;
}) {
  const current = textFromConflictContent(snapshot.stage_2) ?? "";
  const incoming = textFromConflictContent(snapshot.stage_3) ?? "";
  const hunks = useMemo(
    () => (enabled ? buildConflictHunks(resultContent, current, incoming) : []),
    [current, enabled, incoming, resultContent],
  );
  const [announcement, setAnnouncement] = useState("");
  const onApply = useCallback(
    (hunk: MappedConflictHunk, choice: ConflictChoice): void => {
      const applied = viewRef.current ? applyConflictChoice(viewRef.current, hunk, choice) : false;
      setAnnouncement(
        applied
          ? `Applied ${choice} to the selected conflict hunk.`
          : "The hunk changed and could not be applied safely.",
      );
    },
    [viewRef],
  );
  const onViewChange = useCallback(
    (view: EditorView | null): void => onEditorViewChange?.(paneId, view),
    [onEditorViewChange, paneId],
  );
  return useMemo(
    () => ({
      hunks,
      onApply,
      onViewChange,
      announcement,
    }),
    [announcement, hunks, onApply, onViewChange],
  );
}
