import type { DiffConfig } from "@codemirror/merge";

const LARGE_DIFF_CHARACTER_THRESHOLD = 20_000;

// CodeMirror defaults scanLimit to 500, which can collapse large sparse diffs
// into a single giant chunk instead of matching git's smaller changed regions.
const LARGE_DIFF_CONFIG: DiffConfig = { scanLimit: 20_000 };

export function getCadenceDiffConfig(oldContent: string, newContent: string): DiffConfig | undefined {
  const contentLength = Math.max(oldContent.length, newContent.length);
  return contentLength >= LARGE_DIFF_CHARACTER_THRESHOLD ? LARGE_DIFF_CONFIG : undefined;
}
