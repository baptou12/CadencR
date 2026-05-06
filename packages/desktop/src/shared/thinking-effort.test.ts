import { describe, expect, it } from "vitest";
import {
  nextThinkingEffort,
  parseThinkingEffort,
  supportedThinkingEffortLevels,
  thinkingEffortModelKey,
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

  it("builds per-model setting keys matching the Rust helper", () => {
    expect(thinkingEffortModelKey("claude_code", "claude-opus-4")).toBe(
      "thinking_effort_model_claude_code_claude-opus-4",
    );
    expect(thinkingEffortModelKey("opencode", "claude-sonnet-4-5")).toBe(
      "thinking_effort_model_opencode_claude-sonnet-4-5",
    );
  });

  it("cycles to the next supported effort", () => {
    expect(nextThinkingEffort(["low", "medium", "high"], "medium")).toBe("high");
    expect(nextThinkingEffort(["low", "medium", "high"], "high")).toBe("low");
    expect(nextThinkingEffort([], "high")).toBeUndefined();
  });
});
