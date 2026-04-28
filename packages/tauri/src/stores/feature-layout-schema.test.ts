import { describe, expect, it } from "vitest";
import {
  flatLayoutState,
  parseLayoutState,
  serializeLayoutState,
  type FeatureLayoutState,
} from "./feature-layout-schema";

describe("parseLayoutState", () => {
  it("round-trips a flat default state", () => {
    const state = flatLayoutState();
    const json = serializeLayoutState(state);
    const parsed = parseLayoutState(json);
    expect(parsed).toEqual(state);
  });

  it("accepts a nested split tree containing the root leaf", () => {
    const state: FeatureLayoutState = {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        sizes: [60, 40],
        children: [
          { type: "leaf", id: "root", tabIds: ["agent"], activeTabId: "agent" },
          {
            type: "split",
            orientation: "vertical",
            children: [
              { type: "leaf", id: "b", tabIds: ["terminal"], activeTabId: "terminal" },
              { type: "leaf", id: "c", tabIds: ["git", "editor"], activeTabId: "git" },
            ],
          },
        ],
      },
      focusedPaneId: "root",
      appliedLayoutId: 7,
    };
    const parsed = parseLayoutState(serializeLayoutState(state));
    expect(parsed).toEqual(state);
  });

  it("accepts both raw object and JSON string input", () => {
    const state = flatLayoutState();
    const fromObj = parseLayoutState(state);
    const fromJson = parseLayoutState(JSON.stringify(state));
    expect(fromObj).toEqual(state);
    expect(fromJson).toEqual(state);
  });

  it("rejects unknown version", () => {
    expect(parseLayoutState({ ...flatLayoutState(), version: 99 })).toBeNull();
  });

  it("rejects malformed tab ids inside a leaf", () => {
    const broken = {
      ...flatLayoutState(),
      splitRoot: { type: "leaf", id: "root", tabIds: ["nope"], activeTabId: null },
    };
    expect(parseLayoutState(broken)).toBeNull();
  });

  it("rejects a tree without a root leaf", () => {
    const state = {
      version: 1,
      splitRoot: { type: "leaf", id: "not-root", tabIds: ["agent"], activeTabId: "agent" },
      focusedPaneId: null,
      appliedLayoutId: null,
    };
    expect(parseLayoutState(state)).toBeNull();
  });

  it("rejects malformed split children count", () => {
    const state = {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        children: [{ type: "leaf", id: "root", tabIds: [], activeTabId: null }],
      },
      focusedPaneId: null,
      appliedLayoutId: null,
    };
    expect(parseLayoutState(state)).toBeNull();
  });

  it("rejects garbage strings", () => {
    expect(parseLayoutState("not json")).toBeNull();
    expect(parseLayoutState("{")).toBeNull();
    expect(parseLayoutState(null)).toBeNull();
    expect(parseLayoutState(undefined)).toBeNull();
  });
});
