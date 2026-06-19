import { describe, it, expect } from "vitest";
import { symbolPathAt, type FlatSymbol } from "./document-symbols";

// A class spanning 0..100 with a method spanning 20..60 and an inner
// function spanning 30..50.
const symbols: FlatSymbol[] = [
  { name: "MyClass", kind: 5, depth: 0, selectionFrom: 6, from: 0, to: 100 },
  { name: "myMethod", kind: 6, depth: 1, selectionFrom: 26, from: 20, to: 60 },
  { name: "inner", kind: 12, depth: 2, selectionFrom: 33, from: 30, to: 50 },
  { name: "other", kind: 12, depth: 0, selectionFrom: 110, from: 105, to: 150 },
];

describe("symbolPathAt", () => {
  it("returns the full ancestor path at a deeply nested cursor", () => {
    expect(symbolPathAt(symbols, 40).map((s) => s.name)).toEqual(["MyClass", "myMethod", "inner"]);
  });

  it("returns only enclosing ancestors at a shallower cursor", () => {
    expect(symbolPathAt(symbols, 65).map((s) => s.name)).toEqual(["MyClass"]);
  });

  it("returns a sibling-level symbol without leaking the previous branch", () => {
    expect(symbolPathAt(symbols, 120).map((s) => s.name)).toEqual(["other"]);
  });

  it("returns an empty path when the cursor is outside every symbol", () => {
    expect(symbolPathAt(symbols, 102)).toEqual([]);
  });
});
