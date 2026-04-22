import { EditorView, GutterMarker, gutter, ViewPlugin } from "@codemirror/view";
import { type Extension, StateField, StateEffect } from "@codemirror/state";
import { DIFF_PALETTE } from "@/components/editor/editor-theme";

const setHoveredLine = StateEffect.define<number | null>();

const hoveredLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoveredLine)) return e.value;
    }
    return value;
  },
});

class AddCommentMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.textContent = "+";
    el.className = "cm-add-comment-marker";
    return el;
  }
}

const visibleMarker = new AddCommentMarker();

const gutterTheme = EditorView.theme(
  {
    ".cm-add-comment-gutter": {
      width: "24px",
    },
    ".cm-add-comment-gutter .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
    },
    ".cm-add-comment-marker": {
      cursor: "pointer",
      color: DIFF_PALETTE.fg,
      background: DIFF_PALETTE.purple,
      fontWeight: "bold",
      fontSize: "12px",
      lineHeight: "1",
      width: "18px",
      height: "18px",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "4px",
    },
  },
  { dark: true },
);

function hoverPlugin(): ViewPlugin<{ destroy(): void }> {
  return ViewPlugin.define((view) => {
    let currentLine: number | null = null;
    let rafId = 0;

    function onMouseMove(e: MouseEvent): void {
      cancelAnimationFrame(rafId);
      const { clientX, clientY } = e;
      rafId = requestAnimationFrame(() => {
        const pos = view.posAtCoords({ x: clientX, y: clientY });
        const line = pos != null ? view.state.doc.lineAt(pos).number : null;
        if (line === currentLine) return;
        currentLine = line;
        view.dispatch({ effects: setHoveredLine.of(line) });
      });
    }

    function onMouseLeave(): void {
      cancelAnimationFrame(rafId);
      if (currentLine == null) return;
      currentLine = null;
      view.dispatch({ effects: setHoveredLine.of(null) });
    }

    view.dom.addEventListener("mousemove", onMouseMove);
    view.dom.addEventListener("mouseleave", onMouseLeave);

    return {
      destroy() {
        cancelAnimationFrame(rafId);
        view.dom.removeEventListener("mousemove", onMouseMove);
        view.dom.removeEventListener("mouseleave", onMouseLeave);
      },
    };
  });
}

/**
 * Gutter that shows "+" on the hovered line for adding line comments.
 * @param onClick Called with 1-based line number when the marker is clicked.
 */
export function commentGutter(onClick: (lineNumber: number) => void): Extension[] {
  return [
    hoveredLineField,
    gutter({
      class: "cm-add-comment-gutter",
      lineMarkerChange: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setHoveredLine))),
      lineMarker: (view, line) => {
        const hoveredLine = view.state.field(hoveredLineField);
        const lineNumber = view.state.doc.lineAt(line.from).number;
        return lineNumber === hoveredLine ? visibleMarker : null;
      },
      domEventHandlers: {
        click: (view, line) => {
          const lineNumber = view.state.doc.lineAt(line.from).number;
          onClick(lineNumber);
          return true;
        },
      },
    }),
    gutterTheme,
    hoverPlugin(),
  ];
}
