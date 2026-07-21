import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { getReadFileQueryKey, useWriteFile, type ReadFileResponse } from "@/api/generated";
import { apiErrorMessage, toastError } from "@/lib/api-errors";
import { useEditorStore } from "@/stores/editor-store";
import { useFreshFileContentSync } from "./useFreshFileContentSync";

interface UseEditorSaveArgs {
  projectId: number;
  featureId: number;
  paneId: string;
  filePath: string;
  /** Loaded file content, forwarded to the fresh-content sync hook. */
  content: string | undefined;
  viewRef: RefObject<EditorView | null>;
  /**
   * Optional pre-save step (format-on-save). Runs and is awaited BEFORE the
   * buffer is read for writing, so the formatted text is what gets persisted.
   * Errors are surfaced by the implementation (toast); we still save the
   * current buffer if it rejects, so a formatter failure never blocks saving.
   */
  beforeWrite?: () => Promise<void>;
}

interface UseEditorSaveResult {
  /** Save the current buffer; surfaces errors via toast. */
  save: () => Promise<void>;
  /** Save quietly (auto-save); flashes the "Auto-saved" status briefly. */
  saveQuiet: () => Promise<void>;
  /** True for ~1.5s after a successful auto-save — drives the status bar. */
  autoSavedVisible: boolean;
  /** Visible async/error state for save controls outside the normal status bar. */
  isSaving: boolean;
  errorMessage: string | null;
}

/**
 * Build a `ReadFileResponse` from freshly-saved text so the read-file query
 * cache can be reconciled without a refetch. Shared with `useExcalidrawSave`.
 */
export function readFileResponseFromContent(content: string): ReadFileResponse {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  return { content, line_count: lines.length, large: false };
}

/**
 * Owns the editor's write path: the write mutation, query-cache reconciliation,
 * the dirty flag, and the transient "Auto-saved" indicator. Extracted from
 * `CodeMirrorEditor` to keep that component under the file-size cap.
 */
export function useEditorSave({
  projectId,
  featureId,
  paneId,
  filePath,
  content,
  viewRef,
  beforeWrite,
}: UseEditorSaveArgs): UseEditorSaveResult {
  const queryClient = useQueryClient();
  const setDirty = useEditorStore((s) => s.setDirty);
  const [autoSavedVisible, setAutoSavedVisible] = useState(false);
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeFile = useWriteFile();
  const mutateAsyncRef = useRef(writeFile.mutateAsync);
  mutateAsyncRef.current = writeFile.mutateAsync;

  // Keep the latest format-on-save step without making `write` unstable.
  const beforeWriteRef = useRef(beforeWrite);
  beforeWriteRef.current = beforeWrite;

  const markLoadedContent = useFreshFileContentSync({ content, viewRef });
  const readFileQueryKey = useMemo(
    () =>
      getReadFileQueryKey({ project_id: projectId, feature_id: featureId, file_path: filePath }),
    [projectId, featureId, filePath],
  );

  const markSavedContent = useCallback(
    (saved: string): void => {
      markLoadedContent(saved);
      queryClient.setQueryData(readFileQueryKey, readFileResponseFromContent(saved));
      setDirty(featureId, paneId, filePath, false);
    },
    [featureId, filePath, markLoadedContent, paneId, queryClient, readFileQueryKey, setDirty],
  );

  const write = useCallback(async (): Promise<string | null> => {
    const view = viewRef.current;
    if (!view) return null;
    if (beforeWriteRef.current) await beforeWriteRef.current();
    const next = view.state.doc.toString();
    await mutateAsyncRef.current({
      data: { project_id: projectId, feature_id: featureId, file_path: filePath, content: next },
    });
    markSavedContent(next);
    return next;
  }, [projectId, featureId, filePath, markSavedContent, viewRef]);

  const save = useCallback(async () => {
    setPendingSaveCount((count) => count + 1);
    setErrorMessage(null);
    try {
      await write();
    } catch (err) {
      setErrorMessage(apiErrorMessage(err, "Failed to save file"));
      toastError(err, "Failed to save file");
    } finally {
      setPendingSaveCount((count) => Math.max(0, count - 1));
    }
  }, [write]);

  const saveQuiet = useCallback(async () => {
    setPendingSaveCount((count) => count + 1);
    setErrorMessage(null);
    try {
      const saved = await write();
      if (saved === null) return;
      setAutoSavedVisible(true);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
      autoSavedTimerRef.current = setTimeout(() => setAutoSavedVisible(false), 1500);
    } catch (err) {
      setErrorMessage(apiErrorMessage(err, "Failed to auto-save file"));
      toastError(err, "Failed to auto-save file");
    } finally {
      setPendingSaveCount((count) => Math.max(0, count - 1));
    }
  }, [write]);

  useEffect(() => {
    return () => {
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
    };
  }, []);

  return useMemo(
    () => ({
      save,
      saveQuiet,
      autoSavedVisible,
      isSaving: pendingSaveCount > 0,
      errorMessage,
    }),
    [autoSavedVisible, errorMessage, pendingSaveCount, save, saveQuiet],
  );
}
