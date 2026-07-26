import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { isLargeDiffByLines } from "@/lib/diff-thresholds";

/** Minimal per-file shape the auto-collapse rule reads from the changed-files list. */
interface CollapsibleFile {
  file: string;
  additions: number;
  deletions: number;
}

/**
 * Collapse very large files when a new diff loads so a single giant file
 * doesn't block the main thread rendering through Pierre on open. Keyed on the
 * file-set signature so it re-applies once per diff but never fights the user
 * re-expanding a large file within the same diff.
 */
export function useCollapseLargeFilesOnLoad(
  files: CollapsibleFile[],
  setCollapsedFiles: Dispatch<SetStateAction<Set<string>>>,
): void {
  const signatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (files.length === 0) return;
    const signature = files.map((f) => f.file).join("\n");
    if (signatureRef.current === signature) return;
    signatureRef.current = signature;

    const largeFiles = files
      .filter((f) => isLargeDiffByLines(f.additions, f.deletions))
      .map((f) => f.file);
    if (largeFiles.length === 0) return;

    setCollapsedFiles((prev) => new Set([...prev, ...largeFiles]));
  }, [files, setCollapsedFiles]);
}

export function useCollapseActions(
  setCollapsedFiles: Dispatch<SetStateAction<Set<string>>>,
  scanSelection: <T>(run: () => T) => T,
  selectPath: (filePath: string) => boolean,
): { collapseFile: (filePath: string) => void; toggleFile: (filePath: string) => void } {
  const collapseFile = useCallback(
    (filePath: string): void => {
      setCollapsedFiles((previous) =>
        previous.has(filePath) ? previous : new Set([...previous, filePath]),
      );
    },
    [setCollapsedFiles],
  );
  const toggleFile = useCallback(
    (filePath: string): void => {
      // Scanned, not revealed: letting the selection open the file first would
      // queue an expand ahead of this toggle, so collapsing worked and
      // expanding cancelled itself out.
      scanSelection(() => selectPath(filePath));
      setCollapsedFiles((previous) => {
        const next = new Set(previous);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      });
    },
    [scanSelection, selectPath, setCollapsedFiles],
  );
  return { collapseFile, toggleFile };
}
