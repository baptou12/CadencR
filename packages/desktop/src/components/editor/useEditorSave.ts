import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getReadFileQueryKey, useWriteFile, type ReadFileResponse } from "@/api/generated";
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
}

interface UseEditorSaveResult {
  /** Save the current buffer; surfaces errors via toast. */
  save: () => Promise<void>;
  /** Save quietly (auto-save); flashes the "Auto-saved" status briefly. */
  saveQuiet: () => Promise<void>;
  /** True for ~1.5s after a successful auto-save — drives the status bar. */
  autoSavedVisible: boolean;
}

function readFileResponseFromContent(content: string): ReadFileResponse {
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
}: UseEditorSaveArgs): UseEditorSaveResult {
  const queryClient = useQueryClient();
  const setDirty = useEditorStore((s) => s.setDirty);
  const [autoSavedVisible, setAutoSavedVisible] = useState(false);
  const autoSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeFile = useWriteFile();
  const mutateAsyncRef = useRef(writeFile.mutateAsync);
  mutateAsyncRef.current = writeFile.mutateAsync;

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
    const next = view.state.doc.toString();
    await mutateAsyncRef.current({
      data: { project_id: projectId, feature_id: featureId, file_path: filePath, content: next },
    });
    markSavedContent(next);
    return next;
  }, [projectId, featureId, filePath, markSavedContent, viewRef]);

  const save = useCallback(async () => {
    try {
      await write();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save file");
    }
  }, [write]);

  const saveQuiet = useCallback(async () => {
    try {
      const saved = await write();
      if (saved === null) return;
      setAutoSavedVisible(true);
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
      autoSavedTimerRef.current = setTimeout(() => setAutoSavedVisible(false), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to auto-save file");
    }
  }, [write]);

  useEffect(() => {
    return () => {
      if (autoSavedTimerRef.current) clearTimeout(autoSavedTimerRef.current);
    };
  }, []);

  return { save, saveQuiet, autoSavedVisible };
}
