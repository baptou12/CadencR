/**
 * CodeMirror gutter extension that shows a "+" button on the hovered line for adding comments.
 */
import {
  EditorView,
  GutterMarker,
  gutter,
  ViewPlugin,
} from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { DIFF_PALETTE } from "@/components/editor/editor-theme";

class AddCommentMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.textContent = "+";
    el.className = "cm-add-comment-marker";
    el.style.cssText = `
      cursor: pointer;
      color: ${DIFF_PALETTE.fg};
      background: ${DIFF_PALETTE.purple};
      font-weight: bold;
      font-size: 12px;
      line-height: 1;
      width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.1s;
    `;
    return el;
  }
}

const marker = new AddCommentMarker();

const gutterTheme = EditorView.theme({
  ".cm-add-comment-gutter": {
    width: "24px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
}, { dark: true });

/** ViewPlugin that shows the "+" marker only on the hovered line. */
function hoverPlugin(): ViewPlugin<{ activeMarker: HTMLElement | null }> {
  return ViewPlugin.define((view) => {
    let activeMarker: HTMLElement | null = null;
    let rafId = 0;

    function clearActive() {
      if (activeMarker) {
        activeMarker.style.opacity = "0";
        activeMarker = null;
      }
    }

    function onMouseMove(e: MouseEvent) {
      cancelAnimationFrame(rafId);
      const clientX = e.clientX;
      const clientY = e.clientY;
      const target = e.target as HTMLElement;
      rafId = requestAnimationFrame(() => handleMove(clientX, clientY, target));
    }

    function handleMove(_clientX: number, clientY: number, target: HTMLElement) {
      if (target.closest?.(".cm-deletedChunk, .cm-deletedLine, del")) {
        clearActive();
        return;
      }

      const gutterCol = view.dom.querySelector(".cm-add-comment-gutter");
      if (!gutterCol) return;

      const gutterRect = gutterCol.getBoundingClientRect();
      const gutterX = gutterRect.left + gutterRect.width / 2;
      const el = document.elementFromPoint(gutterX, clientY);
      const marker = el?.closest?.(".cm-gutterElement")?.querySelector<HTMLElement>(".cm-add-comment-marker")
        ?? (el as HTMLElement)?.closest?.(".cm-add-comment-marker") as HTMLElement | null;

      if (marker === activeMarker) return;
      clearActive();
      if (marker) {
        marker.style.opacity = "1";
        activeMarker = marker;
      }
    }

    function onMouseLeave() {
      cancelAnimationFrame(rafId);
      clearActive();
    }

    view.dom.addEventListener("mousemove", onMouseMove);
    view.dom.addEventListener("mouseleave", onMouseLeave);

    return {
      activeMarker,
      destroy() {
        cancelAnimationFrame(rafId);
        view.dom.removeEventListener("mousemove", onMouseMove);
        view.dom.removeEventListener("mouseleave", onMouseLeave);
      },
    };
  });
}

/**
 * Creates a gutter that shows "+" on the hovered line for adding line comments.
 * @param onClick Called with 1-based line number when the marker is clicked.
 */
export function commentGutter(onClick: (lineNumber: number) => void): Extension[] {
  return [
    gutter({
      class: "cm-add-comment-gutter",
      lineMarker: () => marker,
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
