/**
 * Split a single-file unified-diff patch into self-contained sub-patches of
 * bounded size. Pierre's parse/hydrate/render pipeline is synchronous and
 * O(patch size) — a multi-MB single-hunk patch (whole-file rewrite) blocks the
 * main thread for tens of seconds if rendered as one instance. Splitting lets
 * the caller mount one bounded chunk at a time, yielding between chunks.
 *
 * Each chunk repeats the original file header (`diff --git` … `+++`) and gets
 * recomputed `@@ -start,count +start,count @@` headers, so every chunk is a
 * valid unified diff on its own and line numbers stay true to the file.
 */

/** Content lines per chunk. ~400 lines renders in well under a frame budget. */
const CHUNK_MAX_LINES = 400;
/** Byte budget per chunk — guards patches with very long lines. */
const CHUNK_MAX_BYTES = 100_000;

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface SplitState {
  chunks: string[];
  /** Pre-joined file header block (`diff --git` … `+++`), prepended per chunk. */
  header: string;
  /**
   * Body lines of the chunk being built, content pushed once (no per-sub-hunk
   * copy). Each open sub-hunk reserves a slot for its `@@` header, backfilled
   * on close once the line counts are known.
   */
  chunkLines: string[];
  chunkContentLines: number;
  chunkBytes: number;
  /** Index in `chunkLines` of the open sub-hunk's header slot, or -1 if none. */
  subHeaderIndex: number;
  subOldStart: number;
  subNewStart: number;
  subOldCount: number;
  subNewCount: number;
  /** Walk position in the original file (next unconsumed line, per side). */
  oldPos: number;
  newPos: number;
}

function closeSubHunk(s: SplitState): void {
  if (s.subHeaderIndex === -1) return;
  // Git convention: a zero-count side anchors on the line *before* the change.
  const oldStart = s.subOldCount === 0 ? s.subOldStart - 1 : s.subOldStart;
  const newStart = s.subNewCount === 0 ? s.subNewStart - 1 : s.subNewStart;
  s.chunkLines[s.subHeaderIndex] =
    `@@ -${oldStart},${s.subOldCount} +${newStart},${s.subNewCount} @@`;
  s.subHeaderIndex = -1;
  s.subOldCount = 0;
  s.subNewCount = 0;
}

function closeChunk(s: SplitState): void {
  closeSubHunk(s);
  if (s.chunkLines.length === 0) return;
  const body = s.chunkLines.join("\n");
  s.chunks.push(s.header ? `${s.header}\n${body}` : body);
  s.chunkLines = [];
  s.chunkContentLines = 0;
  s.chunkBytes = 0;
}

function consumeContentLine(s: SplitState, line: string): void {
  if (s.subHeaderIndex === -1) {
    s.subOldStart = s.oldPos;
    s.subNewStart = s.newPos;
    s.subHeaderIndex = s.chunkLines.length;
    s.chunkLines.push(""); // reserve the `@@` header slot; filled on close
  }
  if (line.startsWith("-")) {
    s.subOldCount++;
    s.oldPos++;
  } else if (line.startsWith("+")) {
    s.subNewCount++;
    s.newPos++;
  } else {
    // Context line (" ", or "" from tools that trim empty context lines).
    s.subOldCount++;
    s.subNewCount++;
    s.oldPos++;
    s.newPos++;
  }
  s.chunkLines.push(line);
  s.chunkContentLines++;
  s.chunkBytes += line.length + 1;
}

export function splitFilePatch(patch: string): string[] {
  const lines = patch.split("\n");
  const headerEnd = lines.findIndex((line) => line.startsWith("@@"));
  if (headerEnd === -1) return [patch];

  const s: SplitState = {
    chunks: [],
    header: lines.slice(0, headerEnd).join("\n"),
    chunkLines: [],
    chunkContentLines: 0,
    chunkBytes: 0,
    subHeaderIndex: -1,
    subOldStart: 0,
    subNewStart: 0,
    subOldCount: 0,
    subNewCount: 0,
    oldPos: 0,
    newPos: 0,
  };

  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    const hunkHeader = line.startsWith("@@") ? HUNK_HEADER_RE.exec(line) : null;
    if (hunkHeader) {
      closeSubHunk(s);
      // `-a,b`: the hunk covers old lines a..a+b-1; b=0 means "insertion
      // after line a", so the next real old line is a+1. Same for `+`.
      s.oldPos = parseInt(hunkHeader[1], 10) + (hunkHeader[2] === "0" ? 1 : 0);
      s.newPos = parseInt(hunkHeader[3], 10) + (hunkHeader[4] === "0" ? 1 : 0);
      continue;
    }
    if (line.startsWith("\\")) {
      // "\ No newline at end of file" annotates the previous line — keep it
      // in the same sub-hunk, uncounted.
      s.chunkLines.push(line);
      continue;
    }
    if (line === "" && i === lines.length - 1) continue; // trailing newline
    consumeContentLine(s, line);
    const full = s.chunkContentLines >= CHUNK_MAX_LINES || s.chunkBytes >= CHUNK_MAX_BYTES;
    // Don't split right before a no-newline marker — it must stay attached.
    if (full && !lines[i + 1]?.startsWith("\\")) closeChunk(s);
  }
  closeChunk(s);

  // A patch that fits in one chunk is returned verbatim (no rewritten headers).
  return s.chunks.length > 1 ? s.chunks : [patch];
}
