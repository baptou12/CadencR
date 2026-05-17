import { useRef, type RefObject } from "react";
import { useScopedGlobalShortcut } from "@/hooks/useScopedHotkeys";

interface UseDiffKeyboardParams {
  fileNames: string[];
  focusedFileIndex: number;
  setFocusedFileIndex: (index: number) => void;
  scrollToFileIndex: (index: number, behavior?: ScrollBehavior) => void;
  toggleFile: (fileName: string) => void;
  blobShas: Record<string, string>;
  viewedFilesSet: Set<string>;
  markViewed: {
    mutate: (args: {
      featureId: number;
      data: { feature_id: number; file_path: string; blob_sha: string };
    }) => void;
  };
  unmarkViewed: {
    mutate: (args: { featureId: number; params: { file_path: string } }) => void;
  };
  featureId: number;
  diffAreaRef: RefObject<HTMLDivElement | null>;
  setCollapsedFiles: (updater: (prev: Set<string>) => Set<string>) => void;
}

/**
 * Vim-style keyboard navigation for the diff viewer (Ctrl+J/K/L/D/U/H). All
 * shortcuts are scoped to the Git tab so they don't fire while the user is
 * focused on Terminal/Editor/Agent (e.g. Ctrl+D in Terminal must not scroll
 * the diff).
 */
export function useDiffKeyboard({
  fileNames,
  focusedFileIndex,
  setFocusedFileIndex,
  scrollToFileIndex,
  toggleFile,
  blobShas,
  viewedFilesSet,
  markViewed,
  unmarkViewed,
  featureId,
  diffAreaRef,
  setCollapsedFiles,
}: UseDiffKeyboardParams): void {
  const focusedFileIndexRef = useRef(focusedFileIndex);
  focusedFileIndexRef.current = focusedFileIndex;

  useScopedGlobalShortcut(
    "ctrl+j",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const next = Math.min(focusedFileIndexRef.current + 1, fileNames.length - 1);
      setFocusedFileIndex(next);
      scrollToFileIndex(next, "smooth");
    },
    "git",
  );

  useScopedGlobalShortcut(
    "ctrl+k",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const next = Math.max(focusedFileIndexRef.current - 1, 0);
      setFocusedFileIndex(next);
      scrollToFileIndex(next, "smooth");
    },
    "git",
  );

  useScopedGlobalShortcut(
    "ctrl+l",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const idx = focusedFileIndexRef.current;
      if (idx >= 0 && idx < fileNames.length) {
        toggleFile(fileNames[idx]);
      }
    },
    "git",
  );

  useScopedGlobalShortcut(
    "ctrl+d",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      diffAreaRef.current?.scrollBy({
        top: diffAreaRef.current.clientHeight / 2,
        behavior: "smooth",
      });
    },
    "git",
  );

  useScopedGlobalShortcut(
    "ctrl+u",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      diffAreaRef.current?.scrollBy({
        top: -diffAreaRef.current.clientHeight / 2,
        behavior: "smooth",
      });
    },
    "git",
  );

  useScopedGlobalShortcut(
    "ctrl+h",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const idx = focusedFileIndexRef.current;
      if (idx >= 0 && idx < fileNames.length) {
        const name = fileNames[idx];
        const sha = blobShas[name] ?? "";
        if (viewedFilesSet.has(name)) {
          unmarkViewed.mutate({ featureId, params: { file_path: name } });
        } else {
          markViewed.mutate({
            featureId,
            data: { feature_id: featureId, file_path: name, blob_sha: sha },
          });
          setCollapsedFiles((p) => new Set([...p, name]));
        }
      }
    },
    "git",
  );
}
