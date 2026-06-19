/**
 * Breadcrumbs bar above the editor showing the symbol path at the cursor
 * (e.g. `MyClass › myMethod`). Fetches `textDocument/documentSymbol` lazily —
 * once the server is ready and again (debounced) after edits — and derives the
 * enclosing-symbol path from the live cursor offset.
 *
 * Kept cheap: the symbol list is fetched off the render path, the cursor is
 * tracked via a single CodeMirror update listener, and the component is
 * memoized. Renders nothing (and reserves no space) when there are no symbols.
 */
import { memo, useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { ChevronRight } from "lucide-react";
import { documentSymbols, symbolPathAt, type FlatSymbol } from "@/lib/lsp/document-symbols";
import { symbolKindLabel } from "@/lib/lsp/lsp-position";

interface EditorBreadcrumbsProps {
  view: EditorView;
  /** Whether the type-checker server advertises document-symbol support. */
  enabled: boolean;
  /** Bumped when the document changes so symbols are re-fetched (debounced). */
  docVersion: number;
}

const REFETCH_DEBOUNCE_MS = 600;

function EditorBreadcrumbs({ view, enabled, docVersion }: EditorBreadcrumbsProps) {
  const [symbols, setSymbols] = useState<FlatSymbol[]>([]);
  const [cursor, setCursor] = useState<number>(() => view.state.selection.main.head);

  // Fetch symbols when enabled / after edits settle. Errors are swallowed here
  // on purpose: the breadcrumbs are ambient chrome, and every other LSP entry
  // point already surfaces server errors as toasts. A failed fetch just leaves
  // the bar empty rather than spamming a toast on every keystroke.
  useEffect(() => {
    if (!enabled) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void documentSymbols(view)
        .then((result) => {
          if (!cancelled) setSymbols(result);
        })
        .catch(() => {
          if (!cancelled) setSymbols([]);
        });
    }, REFETCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, view, docVersion]);

  // Track the cursor offset to recompute the path. Cheap: just stores a number.
  useEffect(() => {
    const listener = (): void => setCursor(view.state.selection.main.head);
    const dom = view.dom;
    dom.addEventListener("keyup", listener);
    dom.addEventListener("mouseup", listener);
    return () => {
      dom.removeEventListener("keyup", listener);
      dom.removeEventListener("mouseup", listener);
    };
  }, [view]);

  const path = symbolPathAt(symbols, cursor);
  if (path.length === 0) return null;

  return (
    <nav
      className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap border-b border-border bg-card/40 px-3 py-1 text-xs text-muted-foreground"
      aria-label="Symbol breadcrumbs"
    >
      {path.map((symbol, index) => (
        <span key={`${symbol.name}-${symbol.from}`} className="flex items-center gap-0.5">
          {index > 0 && <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />}
          <button
            type="button"
            title={symbolKindLabel(symbol.kind)}
            onClick={() => {
              view.dispatch({ selection: { anchor: symbol.selectionFrom }, scrollIntoView: true });
              view.focus();
            }}
            className="rounded px-1 hover:bg-accent hover:text-foreground transition-colors"
          >
            {symbol.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

export default memo(EditorBreadcrumbs);
