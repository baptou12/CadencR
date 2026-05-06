import { describe, expect, it } from "vitest";
import { validateWsSessionSearch } from "./ws-session-search";

describe("validateWsSessionSearch", () => {
  it("accepts positive integer ids", () => {
    expect(validateWsSessionSearch({ cwd: "/repo", featureId: "7", projectId: 2 })).toEqual({
      cwd: "/repo",
      featureId: 7,
      projectId: 2,
    });
  });

  it("rejects fractional ids", () => {
    expect(() => validateWsSessionSearch({ cwd: "/repo", featureId: "1.5", projectId: 2 })).toThrow(
      /featureId/,
    );
    expect(() => validateWsSessionSearch({ cwd: "/repo", featureId: 1, projectId: "2.5" })).toThrow(
      /projectId/,
    );
  });
});
