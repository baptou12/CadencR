import { afterEach, describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  MAX_BUFFER_MATCHES,
  bufferSearchExtension,
  bufferSearchField,
  closeBufferSearch,
  findNextMatch,
  findPrevMatch,
  setBufferSearchQuery,
} from "../search-extension";

const createdViews: EditorView[] = [];

function makeView(doc: string): EditorView {
  const state = EditorState.create({ doc, extensions: [bufferSearchExtension()] });
  const view = new EditorView({ state });
  createdViews.push(view);
  return view;
}

afterEach(() => {
  while (createdViews.length) {
    createdViews.pop()?.destroy();
  }
});

describe("bufferSearchField", () => {
  it("starts empty", () => {
    const view = makeView("hello world");
    const s = view.state.field(bufferSearchField);
    expect(s.matches).toEqual([]);
    expect(s.activeIndex).toBe(-1);
    expect(s.error).toBeNull();
  });

  it("finds literal matches case-insensitively by default", () => {
    const view = makeView("Foo foo FOO bar");
    setBufferSearchQuery(view, { query: "foo", caseSensitive: false, regex: false });
    const s = view.state.field(bufferSearchField);
    expect(s.matches.length).toBe(3);
    expect(s.activeIndex).toBe(0);
  });

  it("respects case-sensitive mode", () => {
    const view = makeView("Foo foo FOO");
    setBufferSearchQuery(view, { query: "foo", caseSensitive: true, regex: false });
    const s = view.state.field(bufferSearchField);
    expect(s.matches.length).toBe(1);
    expect(s.matches[0]).toEqual({ from: 4, to: 7 });
  });

  it("supports regex search", () => {
    const view = makeView("foo123 bar456 baz");
    setBufferSearchQuery(view, { query: "\\d+", caseSensitive: false, regex: true });
    const s = view.state.field(bufferSearchField);
    expect(s.matches.length).toBe(2);
    expect(s.matches[0].to - s.matches[0].from).toBe(3);
  });

  it("reports an error for invalid regex without throwing", () => {
    const view = makeView("hello");
    setBufferSearchQuery(view, { query: "[unterminated", caseSensitive: false, regex: true });
    const s = view.state.field(bufferSearchField);
    expect(s.error).not.toBeNull();
    expect(s.matches).toEqual([]);
  });

  it("caps matches at MAX_BUFFER_MATCHES and reports truncation", () => {
    const view = makeView("a".repeat(MAX_BUFFER_MATCHES + 50));
    setBufferSearchQuery(view, { query: "a", caseSensitive: false, regex: false });
    const s = view.state.field(bufferSearchField);
    expect(s.matches.length).toBe(MAX_BUFFER_MATCHES);
    expect(s.truncated).toBe(true);
  });

  it("findNextMatch wraps around at the end", () => {
    const view = makeView("a b a b a");
    setBufferSearchQuery(view, { query: "a", caseSensitive: false, regex: false });
    expect(view.state.field(bufferSearchField).activeIndex).toBe(0);
    findNextMatch(view);
    expect(view.state.field(bufferSearchField).activeIndex).toBe(1);
    findNextMatch(view);
    expect(view.state.field(bufferSearchField).activeIndex).toBe(2);
    findNextMatch(view);
    expect(view.state.field(bufferSearchField).activeIndex).toBe(0);
  });

  it("findPrevMatch wraps around at the start", () => {
    const view = makeView("a b a b a");
    setBufferSearchQuery(view, { query: "a", caseSensitive: false, regex: false });
    findPrevMatch(view);
    expect(view.state.field(bufferSearchField).activeIndex).toBe(2);
    findPrevMatch(view);
    expect(view.state.field(bufferSearchField).activeIndex).toBe(1);
  });

  it("closeBufferSearch clears state and matches", () => {
    const view = makeView("foo foo");
    setBufferSearchQuery(view, { query: "foo", caseSensitive: false, regex: false });
    expect(view.state.field(bufferSearchField).matches.length).toBe(2);
    closeBufferSearch(view);
    const s = view.state.field(bufferSearchField);
    expect(s.matches).toEqual([]);
    expect(s.activeIndex).toBe(-1);
    expect(s.query.query).toBe("");
  });
});
