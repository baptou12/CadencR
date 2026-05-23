import { describe, it, expect, beforeEach } from "vitest";
import { clearFeatureSearch, clearPaneSearch, getPaneSearch, setPaneSearch } from "../search-cache";

describe("search-cache", () => {
  // The cache is module-scoped; isolate every test by clearing the keys this
  // test touches before each run.
  beforeEach(() => {
    clearFeatureSearch(1);
    clearFeatureSearch(2);
  });

  it("returns the default state when no entry is set", () => {
    expect(getPaneSearch(1, "main")).toEqual({
      query: "",
      caseSensitive: false,
      regex: false,
    });
  });

  it("round-trips a state through set then get", () => {
    setPaneSearch(1, "main", { query: "foo", caseSensitive: true, regex: false });
    expect(getPaneSearch(1, "main")).toEqual({
      query: "foo",
      caseSensitive: true,
      regex: false,
    });
  });

  it("isolates entries by featureId and paneId", () => {
    setPaneSearch(1, "a", { query: "left", caseSensitive: false, regex: false });
    setPaneSearch(1, "b", { query: "right", caseSensitive: false, regex: false });
    setPaneSearch(2, "a", { query: "other", caseSensitive: false, regex: false });
    expect(getPaneSearch(1, "a").query).toBe("left");
    expect(getPaneSearch(1, "b").query).toBe("right");
    expect(getPaneSearch(2, "a").query).toBe("other");
  });

  it("overwrites the existing entry for the same key", () => {
    setPaneSearch(1, "main", { query: "first", caseSensitive: false, regex: false });
    setPaneSearch(1, "main", { query: "second", caseSensitive: true, regex: true });
    expect(getPaneSearch(1, "main")).toEqual({
      query: "second",
      caseSensitive: true,
      regex: true,
    });
  });

  it("clearPaneSearch drops only the targeted pane", () => {
    setPaneSearch(1, "a", { query: "keep", caseSensitive: false, regex: false });
    setPaneSearch(1, "b", { query: "drop", caseSensitive: false, regex: false });
    clearPaneSearch(1, "b");
    expect(getPaneSearch(1, "a").query).toBe("keep");
    expect(getPaneSearch(1, "b").query).toBe("");
  });

  it("clearFeatureSearch drops every pane under a feature without touching others", () => {
    setPaneSearch(1, "a", { query: "drop-a", caseSensitive: false, regex: false });
    setPaneSearch(1, "b", { query: "drop-b", caseSensitive: false, regex: false });
    setPaneSearch(2, "a", { query: "keep", caseSensitive: false, regex: false });
    clearFeatureSearch(1);
    expect(getPaneSearch(1, "a").query).toBe("");
    expect(getPaneSearch(1, "b").query).toBe("");
    expect(getPaneSearch(2, "a").query).toBe("keep");
  });
});
