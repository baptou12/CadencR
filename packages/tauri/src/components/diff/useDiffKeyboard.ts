import { useRef, type RefObject } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";

interface UseDiffKeyboardParams {
  fileNames: string[];
  focusedFileIndex: number;
  setFocusedFileIndex: (index: number) => void;
  scrollToFileIndex: (index: number) => void;
  toggleFile: (fileName: string) => void;
  blobShas: Record<string, string>;
  viewedFilesSet: Set<string>;
  markViewed: { mutate: (args: { featureId: number; filePath: string; blobSha: string }) => void };
  unmarkViewed: { mutate: (args: { featureId: number; filePath: string }) => void };
  featureId: number;
  diffAreaRef: RefObject<HTMLDivElement | null>;
  setCollapsedFiles: (updater: (prev: Set<string>) => Set<string>) => void;
}

/** Vim-style keyboard navigation for the diff viewer (Ctrl+J/K/L/D/U/H). */
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

  useGlobalShortcut("ctrl+j", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const next = Math.min(focusedFileIndexRef.current + 1, fileNames.length - 1);
    setFocusedFileIndex(next);
    scrollToFileIndex(next);
  });

  useGlobalShortcut("ctrl+k", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const next = Math.max(focusedFileIndexRef.current - 1, 0);
    setFocusedFileIndex(next);
    scrollToFileIndex(next);
  });

  useGlobalShortcut("ctrl+l", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const idx = focusedFileIndexRef.current;
    if (idx >= 0 && idx < fileNames.length) {
      toggleFile(fileNames[idx]);
    }
  });

  useGlobalShortcut("ctrl+d", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    diffAreaRef.current?.scrollBy({
      top: diffAreaRef.current.clientHeight / 2,
      behavior: "smooth",
    });
  });

  useGlobalShortcut("ctrl+u", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    diffAreaRef.current?.scrollBy({
      top: -diffAreaRef.current.clientHeight / 2,
      behavior: "smooth",
    });
  });

  useGlobalShortcut("ctrl+h", (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const idx = focusedFileIndexRef.current;
    if (idx >= 0 && idx < fileNames.length) {
      const name = fileNames[idx];
      const sha = blobShas[name] ?? "";
      if (viewedFilesSet.has(name)) {
        unmarkViewed.mutate({ featureId, filePath: name });
      } else {
        markViewed.mutate({ featureId, filePath: name, blobSha: sha });
        setCollapsedFiles((p) => new Set([...p, name]));
      }
    }
  });
}
