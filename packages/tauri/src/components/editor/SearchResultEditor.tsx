import { useEffect, useMemo, useRef } from "react";
import { EditorView, lineNumbers, Decoration, type DecorationSet } from "@codemirror/view";
import { EditorState, StateField, type Extension, RangeSetBuilder } from "@codemirror/state";
import { cadencrEditorTheme } from "./editor-theme";
import { getLanguageExtension } from "./language-extensions";
import type { ContentMatch } from "@/api/generated";

interface SearchResultEditorProps {
  filePath: string;
  matches: ContentMatch[];
  onClick: (lineNumber: number) => void;
}

/** Readonly CodeMirror showing all search matches for a file, merged with separators. */
export default function SearchResultEditor({
  filePath,
  matches,
  onClick,
}: SearchResultEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lineMapRef = useRef<Map<number, number>>(new Map());

  const { doc, highlights, lineMap } = useMemo(() => buildMergedDoc(matches), [matches]);
  lineMapRef.current = lineMap;

  const langExt = useMemo(() => getLanguageExtension(filePath), [filePath]);

  useEffect(() => {
    if (!containerRef.current) return;

    const highlightField = buildHighlightField(highlights);

    // Map editor line numbers to original file line numbers
    const customLineNumbers = lineNumbers({
      formatNumber: (n: number) => {
        const original = lineMap.get(n);
        return original != null ? String(original) : "";
      },
    });

    const extensions: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      customLineNumbers,
      highlightField,
      ...cadencrEditorTheme,
      compactTheme,
      ...(langExt ? [langExt] : []),
    ];

    const state = EditorState.create({ doc, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [doc, highlights, lineMap, langExt]);

  function handleClick(e: React.MouseEvent) {
    const view = viewRef.current;
    if (!view) {
      onClick(matches[0]?.line_number ?? 1);
      return;
    }

    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) {
      onClick(matches[0]?.line_number ?? 1);
      return;
    }

    const editorLine = view.state.doc.lineAt(pos).number;
    const originalLine = lineMapRef.current.get(editorLine);
    onClick(originalLine ?? matches[0]?.line_number ?? 1);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick(matches[0]?.line_number ?? 1);
      }}
      className="cursor-pointer rounded overflow-hidden hover:ring-1 hover:ring-primary/40 transition-shadow"
    >
      <div ref={containerRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HighlightRange {
  from: number;
  to: number;
}

/**
 * Merge multiple matches from the same file into a single document.
 * Overlapping/adjacent context regions are merged. Non-contiguous blocks
 * are separated by a "..." line.
 */
function buildMergedDoc(matches: ContentMatch[]): {
  doc: string;
  highlights: HighlightRange[];
  lineMap: Map<number, number>; // editor line (1-based) → original line number
} {
  if (matches.length === 0) return { doc: "", highlights: [], lineMap: new Map() };

  // Build line ranges for each match (original line numbers, 1-based)
  const blocks: { startLine: number; lines: string[]; matchIdx: number; matchOffset: number }[] =
    [];

  for (let mi = 0; mi < matches.length; mi++) {
    const m = matches[mi];
    const startLine = Number(m.line_number) - m.context_before.length;
    const allLines = [...m.context_before, m.line_content, ...m.context_after];
    blocks.push({ startLine, lines: allLines, matchIdx: mi, matchOffset: m.context_before.length });
  }

  // Merge overlapping/adjacent blocks
  const merged: {
    startLine: number;
    lines: string[];
    matchHighlights: { localLine: number; start: number; end: number }[];
  }[] = [];

  for (const block of blocks) {
    const m = matches[block.matchIdx];
    const blockEnd = block.startLine + block.lines.length - 1;
    const last = merged[merged.length - 1];

    if (last) {
      const lastEnd = last.startLine + last.lines.length - 1;
      if (block.startLine <= lastEnd + 2) {
        // Overlapping or adjacent — extend
        const newEnd = Math.max(lastEnd, blockEnd);
        // Add any new lines beyond the current merged block
        for (let line = lastEnd + 1; line <= newEnd; line++) {
          const idx = line - block.startLine;
          if (idx >= 0 && idx < block.lines.length) {
            last.lines.push(block.lines[idx]);
          }
        }
        // Add highlight for the match line
        const matchLocalLine = Number(m.line_number) - last.startLine;
        last.matchHighlights.push({
          localLine: matchLocalLine,
          start: m.match_start,
          end: m.match_end,
        });
        continue;
      }
    }

    // New block
    const matchLocalLine = block.matchOffset;
    merged.push({
      startLine: block.startLine,
      lines: [...block.lines],
      matchHighlights: [{ localLine: matchLocalLine, start: m.match_start, end: m.match_end }],
    });
  }

  // Assemble final document
  const docLines: string[] = [];
  const lineMap = new Map<number, number>();
  const highlights: HighlightRange[] = [];
  let charOffset = 0;

  for (let bi = 0; bi < merged.length; bi++) {
    if (bi > 0) {
      // Separator line
      docLines.push("  ···");
      charOffset += 5 + 1; // "  ···" + newline
    }

    const block = merged[bi];
    for (let li = 0; li < block.lines.length; li++) {
      const editorLineNum = docLines.length + 1; // 1-based
      const originalLineNum = block.startLine + li;
      lineMap.set(editorLineNum, originalLineNum);

      const line = block.lines[li];
      docLines.push(line);

      // Check if any highlight falls on this local line
      for (const hl of block.matchHighlights) {
        if (hl.localLine === li) {
          highlights.push({
            from: charOffset + hl.start,
            to: charOffset + hl.end,
          });
        }
      }

      charOffset += line.length + 1; // +1 for newline
    }
  }

  return { doc: docLines.join("\n"), highlights, lineMap };
}

const matchMark = Decoration.mark({ class: "cm-search-match" });

function buildHighlightField(ranges: HighlightRange[]): Extension {
  return StateField.define<DecorationSet>({
    create() {
      const builder = new RangeSetBuilder<Decoration>();
      // Ranges must be sorted by from position
      const sorted = [...ranges].sort((a, b) => a.from - b.from);
      for (const r of sorted) {
        if (r.from < r.to) {
          builder.add(r.from, r.to, matchMark);
        }
      }
      return builder.finish();
    },
    update(decos) {
      return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

const compactTheme = EditorView.theme(
  {
    "&": {
      fontSize: "12px",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-content": {
      padding: "2px 0",
    },
    ".cm-line": {
      padding: "0 4px",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
    },
    ".cm-gutters": {
      paddingRight: "2px",
    },
    ".cm-search-match": {
      backgroundColor: "rgba(189, 147, 249, 0.25)",
      borderRadius: "2px",
    },
  },
  { dark: true },
);
