import { describe, expect, it } from "vitest";
import {
  nextThinkingEffort,
  parseThinkingEffort,
  supportedThinkingEffortLevels,
  thinkingEffortSettingKey,
} from "./thinking-effort";

describe("thinking-effort helpers", () => {
  it("returns only supported ordered effort levels", () => {
    expect(
      supportedThinkingEffortLevels({
        supports_effort: true,
        supported_effort_levels: ["max", "low", "medium"],
      }),
    ).toEqual(["low", "medium", "max"]);
  });

  it("parses valid effort values", () => {
    expect(parseThinkingEffort("high")).toBe("high");
    expect(parseThinkingEffort("nope")).toBeUndefined();
  });

  it("builds scoped setting keys", () => {
    expect(thinkingEffortSettingKey("session")).toBe("thinking_effort_session");
  });

  it("cycles to the next supported effort", () => {
    expect(nextThinkingEffort(["low", "medium", "high"], "medium")).toBe("high");
    expect(nextThinkingEffort(["low", "medium", "high"], "high")).toBe("low");
    expect(nextThinkingEffort([], "high")).toBeUndefined();
  });
});
