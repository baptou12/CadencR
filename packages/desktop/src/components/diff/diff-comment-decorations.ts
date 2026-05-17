/**
 * CodeMirror extensions for rendering diff comment widgets inline.
 *
 * Widgets render React components via createRoot in toDOM(),
 * and a ViewPlugin handles cleanup of React roots on destroy.
 */
import { EditorView, Decoration, WidgetType, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, RangeSetBuilder, type Extension } from "@codemirror/state";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { CommentExtendLine, CommentWidgetLine, type DiffComment } from "./DiffCommentWidget";

// ---- Module-level root tracking for cleanup ----
const widgetRoots = new WeakMap<HTMLElement, Root>();

// ---- Types ----

export interface CommentLineData {
  lineNumber: number;
  comments: DiffComment[];
}

export interface ActiveWidget {
  lineNumber: number;
  side?: "old" | "new";
}

export interface CommentCallbacks {
  onSubmit: (lineNumber: number, content: string) => void;
  onClose: () => void;
  onEdit: (id: number, content: string) => void;
  onDelete: (id: number) => void;
}

interface CommentState {
  lines: CommentLineData[];
  activeWidget: ActiveWidget | null;
  callbacks: CommentCallbacks;
}

// ---- Effect ----

export const setCommentData = StateEffect.define<CommentState>();

// ---- Widgets ----

function mountReact(container: HTMLElement, element: React.ReactElement): void {
  let root = widgetRoots.get(container);
  if (!root) {
    root = createRoot(container);
    widgetRoots.set(container, root);
  }
  root.render(element);
}

function unmountReact(container: HTMLElement): void {
  const root = widgetRoots.get(container);
  if (root) {
    root.unmount();
    widgetRoots.delete(container);
  }
}

class CommentDisplayWidget extends WidgetType {
  constructor(
    readonly comments: DiffComment[],
    readonly callbacks: CommentCallbacks,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    mountReact(
      container,
      createElement(CommentExtendLine, {
        comments: this.comments,
        onEdit: this.callbacks.onEdit,
        onDelete: this.callbacks.onDelete,
      }),
    );
    return container;
  }

  updateDOM(dom: HTMLElement): boolean {
    mountReact(
      dom,
      createElement(CommentExtendLine, {
        comments: this.comments,
        onEdit: this.callbacks.onEdit,
        onDelete: this.callbacks.onDelete,
      }),
    );
    return true;
  }

  eq(other: CommentDisplayWidget): boolean {
    return (
      this.comments.length === other.comments.length &&
      this.comments.every(
        (c, i) => c.id === other.comments[i].id && c.content === other.comments[i].content,
      )
    );
  }

  destroy(dom: HTMLElement): void {
    unmountReact(dom);
  }
}

class CommentFormWidget extends WidgetType {
  constructor(
    readonly existingComments: DiffComment[],
    readonly lineNumber: number,
    readonly callbacks: CommentCallbacks,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    mountReact(
      container,
      createElement(CommentWidgetLine, {
        comments: this.existingComments,
        onSubmit: (content: string) => this.callbacks.onSubmit(this.lineNumber, content),
        onClose: this.callbacks.onClose,
        onEdit: this.callbacks.onEdit,
        onDelete: this.callbacks.onDelete,
      }),
    );
    return container;
  }

  eq(): boolean {
    return false; // Always re-render form
  }

  destroy(dom: HTMLElement): void {
    unmountReact(dom);
  }
}

// ---- State field ----

function buildDecorations(
  state: CommentState,
  doc: { lines: number; line: (n: number) => { from: number } },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const entries: { pos: number; deco: Decoration }[] = [];

  for (const { lineNumber, comments } of state.lines) {
    if (lineNumber < 1 || lineNumber > doc.lines) continue;
    // If active widget is on this line, show form instead
    if (state.activeWidget?.lineNumber === lineNumber) continue;
    if (comments.length === 0) continue;

    const pos = doc.line(lineNumber).from;
    entries.push({
      pos,
      deco: Decoration.widget({
        widget: new CommentDisplayWidget(comments, state.callbacks),
        block: true,
        side: 1,
      }),
    });
  }

  if (state.activeWidget) {
    const ln = state.activeWidget.lineNumber;
    if (ln >= 1 && ln <= doc.lines) {
      const existing = state.lines.find((cl) => cl.lineNumber === ln);
      const pos = doc.line(ln).from;
      entries.push({
        pos,
        deco: Decoration.widget({
          widget: new CommentFormWidget(existing?.comments ?? [], ln, state.callbacks),
          block: true,
          side: 1,
        }),
      });
    }
  }

  entries.sort((a, b) => a.pos - b.pos);
  for (const { pos, deco } of entries) {
    builder.add(pos, pos, deco);
  }
  return builder.finish();
}

const commentField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCommentData)) {
        return buildDecorations(effect.value, tr.state.doc);
      }
    }
    if (tr.docChanged) {
      return decos.map(tr.changes);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Returns CodeMirror extensions for diff comment widgets. */
export function commentExtensions(): Extension[] {
  return [commentField];
}

/**
 * Dispatch comment data to a CodeMirror EditorView.
 * Call this whenever comments or the active widget changes.
 */
export function dispatchCommentData(
  view: EditorView,
  lines: CommentLineData[],
  activeWidget: ActiveWidget | null,
  callbacks: CommentCallbacks,
): void {
  view.dispatch({
    effects: setCommentData.of({ lines, activeWidget, callbacks }),
  });
}
