import {
  EditorView,
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { BlameLine } from "@/api/generated";

function buildDecorations(view: EditorView, blameByLine: Map<number, BlameLine>): DecorationSet {
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const blame = blameByLine.get(cursorLine);
  if (!blame) return Decoration.none;

  const line = view.state.doc.line(cursorLine);
  if (line.length === 0) return Decoration.none;

  const text = `${blame.author} \u00b7 ${blame.date} \u00b7 ${blame.summary}`;
  return Decoration.set([
    Decoration.line({
      attributes: {
        "data-blame": text,
        class: "cm-git-blame-line",
      },
    }).range(line.from),
  ]);
}

const blameTheme = EditorView.baseTheme({
  ".cm-git-blame-line::after": {
    content: "attr(data-blame)",
    color: "var(--muted-foreground, #6272a4)",
    opacity: "0.7",
    paddingLeft: "2em",
    fontSize: "0.85em",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
});

export function gitBlameExtension(lines: BlameLine[]): Extension {
  const blameByLine = new Map<number, BlameLine>();
  for (const line of lines) {
    blameByLine.set(line.line, line);
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      prevLine: number;

      constructor(view: EditorView) {
        this.prevLine = view.state.doc.lineAt(view.state.selection.main.head).number;
        this.decorations = buildDecorations(view, blameByLine);
      }

      update(update: ViewUpdate): void {
        if (!update.selectionSet && !update.docChanged) return;
        const line = update.state.doc.lineAt(update.state.selection.main.head).number;
        if (line === this.prevLine && !update.docChanged) return;
        this.prevLine = line;
        this.decorations = buildDecorations(update.view, blameByLine);
      }
    },
    { decorations: (v) => v.decorations },
  );

  return [plugin, blameTheme];
}
