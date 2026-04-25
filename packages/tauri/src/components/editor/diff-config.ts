import type { DiffConfig } from "@codemirror/merge";

/**
 * Mid-sized files (above ~20 KB but below `LARGE_DIFF_BYTES`) get a higher
 * `scanLimit` so CodeMirror's diff algorithm can find multiple small changes
 * spread across the file instead of collapsing them into one giant chunk.
 *
 * Anything ≥ `LARGE_DIFF_BYTES` (200 KB) never reaches CodeMirror — the
 * `DiffFileBlock` shows a "Display diff" placeholder for those — so we don't
 * pay the cost of scanning huge files here.
 */
const SPARSE_DIFF_CHARACTER_THRESHOLD = 20_000;

const SPARSE_DIFF_CONFIG: DiffConfig = { scanLimit: 20_000 };

export function getCadenceDiffConfig(
  oldContent: string,
  newContent: string,
): DiffConfig | undefined {
  const contentLength = Math.max(oldContent.length, newContent.length);
  return contentLength >= SPARSE_DIFF_CHARACTER_THRESHOLD ? SPARSE_DIFF_CONFIG : undefined;
}
