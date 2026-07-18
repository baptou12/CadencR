import { describe, expect, it } from "vitest";
import { favoriteModelKey, parseFavoriteModels } from "./favorite-models";

describe("favorite-models", () => {
  it("keys a model by provider and model id", () => {
    expect(favoriteModelKey("claude_code", "opus")).toBe("claude_code:opus");
  });

  it("round-trips a favorites list", () => {
    const keys = ["claude_code:opus", "codex:gpt-5"];
    expect(parseFavoriteModels(JSON.stringify(keys))).toEqual(keys);
  });

  it("treats an unset setting as no favorites", () => {
    expect(parseFavoriteModels(null)).toEqual([]);
    expect(parseFavoriteModels("")).toEqual([]);
  });

  it("drops non-string entries", () => {
    expect(parseFavoriteModels('["claude_code:opus", 3, null]')).toEqual(["claude_code:opus"]);
  });

  it("throws on malformed values so the caller can surface them", () => {
    expect(() => parseFavoriteModels("not json")).toThrow();
    expect(() => parseFavoriteModels('{"a":1}')).toThrow(/array/);
  });
});
