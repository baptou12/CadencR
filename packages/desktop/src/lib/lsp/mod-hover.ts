/**
 * Underlines the word under the mouse while CMD/CTRL is held, telegraphing
 * that the symbol is cmd-clickable. We deliberately don't ask the LSP if
 * the symbol has a definition — that would add a network round-trip per
 * `mousemove` and the underline would lag the cursor. If the user clicks
 * and there is no definition, [`lspModClickExtension`] silently no-ops,
 * which matches IDE convention (VS Code does the same).
 *
 * Owns no module-scope state; each editor's range lives in its own
 * `StateField`, so multiple panes don't fight over the highlight.
 */
import { EditorView, Decoration, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, type EditorState, type Extension } from "@codemirror/state";

interface Range {
  from: number;
  to: number;
}

const setHoverRange = StateEffect.define<Range | null>();

const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoverRange)) {
        if (e.value == null) return Decoration.none;
        return Decoration.set([
          Decoration.mark({ class: "cm-lsp-mod-hover" }).range(e.value.from, e.value.to),
        ]);
      }
    }
    // Map through doc changes so the highlight tracks edits if the user
    // somehow types while holding the modifier.
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Read the current highlighted range, or `null` if nothing is highlighted. */
function currentRange(state: EditorState): Range | null {
  const deco = state.field(hoverField, false);
  if (!deco) return null;
  let result: Range | null = null;
  deco.between(0, state.doc.length, (from, to) => {
    result = { from, to };
    return false; // stop after first
  });
  return result;
}

function clearHover(view: EditorView): void {
  if (currentRange(view.state) == null) return;
  view.dispatch({ effects: setHoverRange.of(null) });
}

function updateHover(view: EditorView, clientX: number, clientY: number): void {
  const pos = view.posAtCoords({ x: clientX, y: clientY });
  if (pos == null) {
    clearHover(view);
    return;
  }
  const word = view.state.wordAt(pos);
  if (!word) {
    clearHover(view);
    return;
  }
  const next: Range = { from: word.from, to: word.to };
  const current = currentRange(view.state);
  if (current && current.from === next.from && current.to === next.to) return;
  view.dispatch({ effects: setHoverRange.of(next) });
}

/**
 * Test-only: drive the hover decoration imperatively. The real extension
 * derives the range from mouse coordinates and `state.wordAt`, neither of
 * which happy-dom resolves in jsdom — so unit tests reach in here instead
 * of synthesising fake `MouseEvent`s with computed layout.
 *
 * @internal
 */
export function __setHoverForTest(view: EditorView, range: Range | null): void {
  view.dispatch({ effects: setHoverRange.of(range) });
}

/** @public */
export function lspModHoverExtension(): Extension {
  const handlers = EditorView.domEventHandlers({
    mousemove(event, view) {
      if (event.metaKey || event.ctrlKey) {
        updateHover(view, event.clientX, event.clientY);
      } else {
        clearHover(view);
      }
    },
    mouseleave(_event, view) {
      clearHover(view);
    },
    keyup(event, view) {
      // Releasing the modifier should drop the underline immediately; we
      // don't wait for the next mousemove because the user may stay still.
      if (event.key === "Meta" || event.key === "Control") {
        clearHover(view);
      }
    },
    blur(_event, view) {
      // Tab-switch / focus-loss with modifier still pressed would otherwise
      // leave a dangling underline.
      clearHover(view);
    },
  });

  const theme = EditorView.theme({
    ".cm-lsp-mod-hover": {
      textDecoration: "underline",
      textUnderlineOffset: "2px",
      cursor: "pointer",
    },
  });

  return [hoverField, handlers, theme];
}
