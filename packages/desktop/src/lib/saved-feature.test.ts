import { describe, expect, it } from "vitest";
import { parseSavedFeature } from "./saved-feature";

describe("parseSavedFeature", () => {
  it("returns null for empty or missing input", () => {
    expect(parseSavedFeature(undefined)).toBeNull();
    expect(parseSavedFeature(null)).toBeNull();
    expect(parseSavedFeature("")).toBeNull();
  });

  it("returns null on malformed JSON without throwing", () => {
    expect(parseSavedFeature("not-json")).toBeNull();
  });

  it("returns null when ids are not numbers", () => {
    expect(parseSavedFeature(JSON.stringify({ projectId: "1", featureId: 2 }))).toBeNull();
    expect(parseSavedFeature(JSON.stringify({ projectId: 1 }))).toBeNull();
  });

  it("parses the saved tuple and preserves a string activeTab", () => {
    expect(
      parseSavedFeature(JSON.stringify({ projectId: 7, featureId: 42, activeTab: "agent" })),
    ).toEqual({ projectId: 7, featureId: 42, activeTab: "agent" });
  });

  it("drops a non-string activeTab", () => {
    expect(parseSavedFeature(JSON.stringify({ projectId: 1, featureId: 2, activeTab: 3 }))).toEqual(
      { projectId: 1, featureId: 2, activeTab: undefined },
    );
  });
});
