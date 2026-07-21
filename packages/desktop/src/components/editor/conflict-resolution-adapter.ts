import type { EditorView } from "@codemirror/view";

export type ConflictChoice = "current" | "incoming" | "both";

export interface ConflictHunk {
  id: string;
  markerText: string;
  current: string;
  incoming: string;
  precise: boolean;
}

export interface MappedConflictHunk extends ConflictHunk {
  from: number | null;
  to: number | null;
  disabledReason: string | null;
}

/**
 * Cadencr-owned boundary around CodeMirror's merge diffing. Git marker parsing
 * stays here so the resolver UI never depends on merge-package internals.
 */
export function buildConflictHunks(
  result: string,
  currentSource: string,
  incomingSource: string,
): ConflictHunk[] {
  const parsed = parseConflictMarkers(result);
  return parsed.map((hunk, index) => ({
    ...hunk,
    id: `conflict-${index + 1}`,
    precise:
      sourceContains(currentSource, hunk.current) && sourceContains(incomingSource, hunk.incoming),
  }));
}

export function mapConflictHunk(documentText: string, hunk: ConflictHunk): MappedConflictHunk {
  const from = documentText.indexOf(hunk.markerText);
  if (from < 0) {
    return { ...hunk, from: null, to: null, disabledReason: "This hunk was edited manually." };
  }
  if (documentText.indexOf(hunk.markerText, from + 1) >= 0) {
    return {
      ...hunk,
      from: null,
      to: null,
      disabledReason: "This marker block is ambiguous after overlapping edits.",
    };
  }
  if (!hunk.precise) {
    return {
      ...hunk,
      from: null,
      to: null,
      disabledReason: "The source mapping is not precise enough for a safe action.",
    };
  }
  return { ...hunk, from, to: from + hunk.markerText.length, disabledReason: null };
}

export function applyConflictChoice(
  view: EditorView,
  hunk: ConflictHunk,
  choice: ConflictChoice,
): boolean {
  const mapped = mapConflictHunk(view.state.doc.toString(), hunk);
  if (mapped.from == null || mapped.to == null) return false;
  const insert =
    choice === "current"
      ? hunk.current
      : choice === "incoming"
        ? hunk.incoming
        : `${hunk.current}${hunk.incoming}`;
  view.dispatch({ changes: { from: mapped.from, to: mapped.to, insert } });
  return true;
}

interface ParsedHunk extends Omit<ConflictHunk, "id" | "precise"> {}

function parseConflictMarkers(result: string): ParsedHunk[] {
  const lines = result.match(/.*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const hunks: ParsedHunk[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("<<<<<<<")) continue;
    const start = index;
    let baseSeparator = -1;
    let separator = -1;
    let end = -1;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith("|||||||")) baseSeparator = cursor;
      if (lines[cursor].startsWith("=======")) separator = cursor;
      if (lines[cursor].startsWith(">>>>>>>")) {
        end = cursor;
        break;
      }
    }
    if (separator < 0 || end < 0) continue;
    const currentStart = start + 1;
    const currentEnd = baseSeparator >= 0 ? baseSeparator : separator;
    hunks.push({
      markerText: lines.slice(start, end + 1).join(""),
      current: lines.slice(currentStart, currentEnd).join(""),
      incoming: lines.slice(separator + 1, end).join(""),
    });
    index = end;
  }
  return hunks;
}

function sourceContains(source: string, fragment: string): boolean {
  return fragment.length === 0 || source.includes(fragment.replace(/(?:\r\n|\r)$/g, "\n"));
}
