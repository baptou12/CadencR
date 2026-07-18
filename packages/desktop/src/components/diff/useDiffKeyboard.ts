import { useRef, type RefObject } from "react";
import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";

interface UseDiffKeyboardParams {
  fileNames: string[];
  focusedFileIndex: number;
  setFocusedFileIndex: (index: number) => void;
  scrollToFileIndex: (index: number) => void;
  toggleFile: (fileName: string) => void;
  viewedFilesSet: Set<string>;
  markFileViewed: (fileName: string) => void;
  unmarkFileViewed: (fileName: string) => void;
  diffAreaRef: RefObject<HTMLDivElement | null>;
  onOpenFocusedFileInEditor?: (filePath: string) => void;
}

function useDiffViewedShortcut({
  fileNames,
  focusedFileIndexRef,
  viewedFilesSet,
  markFileViewed,
  unmarkFileViewed,
}: Pick<
  UseDiffKeyboardParams,
  "fileNames" | "viewedFilesSet" | "markFileViewed" | "unmarkFileViewed"
> & { focusedFileIndexRef: RefObject<number> }): void {
  useScopedGlobalShortcutById(
    "diff-mark-viewed",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const index = focusedFileIndexRef.current;
      if (index < 0 || index >= fileNames.length) return;
      const fileName = fileNames[index];
      if (viewedFilesSet.has(fileName)) unmarkFileViewed(fileName);
      else markFileViewed(fileName);
    },
    "git",
  );
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
  viewedFilesSet,
  markFileViewed,
  unmarkFileViewed,
  diffAreaRef,
  onOpenFocusedFileInEditor,
}: UseDiffKeyboardParams): void {
  const focusedFileIndexRef = useRef(focusedFileIndex);
  focusedFileIndexRef.current = focusedFileIndex;

  useScopedGlobalShortcutById(
    "diff-next-file",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const next = Math.min(focusedFileIndexRef.current + 1, fileNames.length - 1);
      setFocusedFileIndex(next);
      scrollToFileIndex(next);
    },
    "git",
  );

  useScopedGlobalShortcutById(
    "diff-prev-file",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const next = Math.max(focusedFileIndexRef.current - 1, 0);
      setFocusedFileIndex(next);
      scrollToFileIndex(next);
    },
    "git",
  );

  useScopedGlobalShortcutById(
    "diff-toggle-file",
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

  useScopedGlobalShortcutById(
    "diff-scroll-down",
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

  useScopedGlobalShortcutById(
    "diff-scroll-up",
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

  useScopedGlobalShortcutById(
    "diff-open-focused-file",
    (e) => {
      const idx = focusedFileIndexRef.current;
      if (!onOpenFocusedFileInEditor || idx < 0 || idx >= fileNames.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onOpenFocusedFileInEditor(fileNames[idx]);
    },
    "git",
    { enabled: Boolean(onOpenFocusedFileInEditor) },
  );

  useDiffViewedShortcut({
    fileNames,
    focusedFileIndexRef,
    viewedFilesSet,
    markFileViewed,
    unmarkFileViewed,
  });
}
