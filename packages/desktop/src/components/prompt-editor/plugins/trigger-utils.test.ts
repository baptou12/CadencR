import { describe, it, expect } from "vitest";
import { getTriggerMatch } from "./trigger-utils";

/** Minimal mock of a Lexical TextNode for getTriggerMatch */
function fakeTextNode(text: string) {
  return { getTextContent: () => text } as Parameters<typeof getTriggerMatch>[0];
}

describe("getTriggerMatch", () => {
  it("matches trigger at start of text", () => {
    const result = getTriggerMatch(fakeTextNode("@foo"), 4, "@");
    expect(result).toEqual({ query: "foo", triggerOffset: 0 });
  });

  it("matches trigger after whitespace", () => {
    const result = getTriggerMatch(fakeTextNode("hello @bar"), 10, "@");
    expect(result).toEqual({ query: "bar", triggerOffset: 6 });
  });

  it("returns null when trigger is mid-word", () => {
    const result = getTriggerMatch(fakeTextNode("test@bar"), 8, "@");
    expect(result).toBeNull();
  });

  it("returns null when no trigger present", () => {
    const result = getTriggerMatch(fakeTextNode("hello world"), 11, "@");
    expect(result).toBeNull();
  });

  it("returns null when query contains a space", () => {
    const result = getTriggerMatch(fakeTextNode("@foo bar"), 8, "@");
    expect(result).toBeNull();
  });

  it("only considers text up to anchorOffset", () => {
    const result = getTriggerMatch(fakeTextNode("@foo @bar"), 4, "@");
    expect(result).toEqual({ query: "foo", triggerOffset: 0 });
  });

  it("works with slash trigger", () => {
    const result = getTriggerMatch(fakeTextNode("/commit"), 7, "/");
    expect(result).toEqual({ query: "commit", triggerOffset: 0 });
  });

  it("returns empty query when only trigger char typed", () => {
    const result = getTriggerMatch(fakeTextNode("@"), 1, "@");
    expect(result).toEqual({ query: "", triggerOffset: 0 });
  });

  it("supports multi-character triggers", () => {
    expect(getTriggerMatch(fakeTextNode("compare @@auth"), 14, "@@")).toEqual({
      query: "auth",
      triggerOffset: 8,
    });
    expect(getTriggerMatch(fakeTextNode("@@"), 2, "@@")).toEqual({
      query: "",
      triggerOffset: 0,
    });
  });
});
