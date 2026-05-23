import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { SearchCursor, RegExpCursor } from "@codemirror/search";

export interface BufferSearchQuery {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}

export interface BufferMatch {
  from: number;
  to: number;
}

export interface BufferSearchState {
  query: BufferSearchQuery;
  matches: BufferMatch[];
  activeIndex: number;
  truncated: boolean;
  error: string | null;
}

export const MAX_BUFFER_MATCHES = 5000;

const EMPTY_QUERY: BufferSearchQuery = { query: "", caseSensitive: false, regex: false };

const INITIAL_STATE: BufferSearchState = {
  query: EMPTY_QUERY,
  matches: [],
  activeIndex: -1,
  truncated: false,
  error: null,
};

export const setBufferSearchQueryEffect = StateEffect.define<BufferSearchQuery>();
export const setBufferActiveIndexEffect = StateEffect.define<number>();
export const closeBufferSearchEffect = StateEffect.define<void>();

const matchMark = Decoration.mark({ class: "cm-buffer-search-match" });
const activeMatchMark = Decoration.mark({
  class: "cm-buffer-search-match cm-buffer-search-match-active",
});

interface ScanResult {
  matches: BufferMatch[];
  truncated: boolean;
  error: string | null;
}

function scanLiteralMatches(state: EditorState, q: BufferSearchQuery): ScanResult {
  const matches: BufferMatch[] = [];
  const normalize = q.caseSensitive ? undefined : (s: string) => s.toLowerCase();
  const cursor = new SearchCursor(state.doc, q.query, 0, state.doc.length, normalize);
  while (!cursor.next().done) {
    const { from, to } = cursor.value;
    if (from === to) break;
    matches.push({ from, to });
    if (matches.length >= MAX_BUFFER_MATCHES) {
      return { matches, truncated: true, error: null };
    }
  }
  return { matches, truncated: false, error: null };
}

function scanRegexMatches(state: EditorState, q: BufferSearchQuery): ScanResult {
  try {
    new RegExp(q.query);
  } catch (err) {
    return {
      matches: [],
      truncated: false,
      error: err instanceof Error ? err.message : "Invalid regex",
    };
  }
  const matches: BufferMatch[] = [];
  const cursor = new RegExpCursor(
    state.doc,
    q.query,
    { ignoreCase: !q.caseSensitive },
    0,
    state.doc.length,
  );
  while (!cursor.next().done) {
    const { from, to } = cursor.value;
    if (from === to) break;
    matches.push({ from, to });
    if (matches.length >= MAX_BUFFER_MATCHES) {
      return { matches, truncated: true, error: null };
    }
  }
  return { matches, truncated: false, error: null };
}

function scanMatches(state: EditorState, q: BufferSearchQuery): ScanResult {
  if (!q.query) return { matches: [], truncated: false, error: null };
  return q.regex ? scanRegexMatches(state, q) : scanLiteralMatches(state, q);
}

function pickInitialActive(matches: BufferMatch[], cursorPos: number): number {
  if (matches.length === 0) return -1;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= cursorPos) return i;
  }
  return 0;
}

function normalizeIndex(idx: number, total: number): number {
  if (total === 0) return -1;
  return ((idx % total) + total) % total;
}

function buildDecorations(state: BufferSearchState): DecorationSet {
  if (state.matches.length === 0) return Decoration.none;
  const ranges = state.matches.map((m, i) =>
    (i === state.activeIndex ? activeMatchMark : matchMark).range(m.from, m.to),
  );
  return Decoration.set(ranges, true);
}

function applyQueryEffect(state: EditorState, query: BufferSearchQuery): BufferSearchState {
  const scan = scanMatches(state, query);
  return {
    query,
    matches: scan.matches,
    activeIndex: pickInitialActive(scan.matches, state.selection.main.head),
    truncated: scan.truncated,
    error: scan.error,
  };
}

export const bufferSearchField = StateField.define<BufferSearchState>({
  create: () => INITIAL_STATE,
  update(value, tr) {
    let next = value;
    let queryChanged = false;
    let closed = false;
    for (const effect of tr.effects) {
      if (effect.is(setBufferSearchQueryEffect)) {
        next = applyQueryEffect(tr.state, effect.value);
        queryChanged = true;
      } else if (effect.is(setBufferActiveIndexEffect)) {
        next = { ...next, activeIndex: normalizeIndex(effect.value, next.matches.length) };
      } else if (effect.is(closeBufferSearchEffect)) {
        next = INITIAL_STATE;
        closed = true;
      }
    }
    if (tr.docChanged && !queryChanged && !closed && next.query.query) {
      const scan = scanMatches(tr.state, next.query);
      const newActive =
        scan.matches.length === 0
          ? -1
          : Math.min(Math.max(0, next.activeIndex), scan.matches.length - 1);
      next = {
        ...next,
        matches: scan.matches,
        activeIndex:
          newActive < 0 ? pickInitialActive(scan.matches, tr.state.selection.main.head) : newActive,
        truncated: scan.truncated,
        error: scan.error,
      };
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f, buildDecorations),
});

export function bufferSearchExtension(): Extension {
  return [bufferSearchField];
}

export function getBufferSearchState(view: EditorView): BufferSearchState {
  return view.state.field(bufferSearchField);
}

export function setBufferSearchQuery(view: EditorView, query: BufferSearchQuery): void {
  view.dispatch({ effects: setBufferSearchQueryEffect.of(query) });
  revealActiveMatch(view);
}

export function findNextMatch(view: EditorView): void {
  const s = view.state.field(bufferSearchField);
  if (s.matches.length === 0) return;
  activateMatch(view, s.activeIndex + 1);
}

export function findPrevMatch(view: EditorView): void {
  const s = view.state.field(bufferSearchField);
  if (s.matches.length === 0) return;
  activateMatch(view, s.activeIndex - 1);
}

export function closeBufferSearch(view: EditorView): void {
  view.dispatch({ effects: closeBufferSearchEffect.of() });
}

function activateMatch(view: EditorView, rawIndex: number): void {
  const s = view.state.field(bufferSearchField);
  if (s.matches.length === 0) return;
  const idx = normalizeIndex(rawIndex, s.matches.length);
  const m = s.matches[idx];
  view.dispatch({
    effects: [
      setBufferActiveIndexEffect.of(idx),
      EditorView.scrollIntoView(m.from, { y: "center" }),
    ],
    selection: { anchor: m.from, head: m.to },
  });
}

function revealActiveMatch(view: EditorView): void {
  const s = view.state.field(bufferSearchField);
  if (s.activeIndex < 0 || s.activeIndex >= s.matches.length) return;
  const m = s.matches[s.activeIndex];
  view.dispatch({
    effects: EditorView.scrollIntoView(m.from, { y: "center" }),
    selection: { anchor: m.from, head: m.to },
  });
}
