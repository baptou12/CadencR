import { useCallback, useRef } from "react";

/**
 * Selecting a row in the tree means "show me this file", so by default it opens
 * the block. Keyboard scanning and the collapse toggle drive the same pierre
 * selection API but must not open anything, so they run their call inside
 * `scanSelection`. Pierre notifies selection listeners synchronously, which is
 * what makes a plain flag enough here.
 */
export function useScannableSelection(
  revealFile: (filePath: string) => void,
  scrollToFile: (filePath: string) => void,
): {
  scanSelection: <T>(run: () => T) => T;
  handleTreeSelection: (filePath: string) => void;
} {
  const scanning = useRef(false);
  const scanSelection = useCallback(<T>(run: () => T): T => {
    scanning.current = true;
    try {
      return run();
    } finally {
      scanning.current = false;
    }
  }, []);
  const handleTreeSelection = useCallback(
    (filePath: string): void => {
      if (scanning.current) scrollToFile(filePath);
      else revealFile(filePath);
    },
    [revealFile, scrollToFile],
  );
  return { scanSelection, handleTreeSelection };
}
