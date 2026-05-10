import { describe, expect, it } from "vitest";
import {
  AGENT_AUTONOMY_OPTIONS,
  DEFAULT_AGENT_AUTONOMY,
  parseAgentAutonomy,
} from "./agent-autonomy";

describe("parseAgentAutonomy", () => {
  it("returns the value when it matches a known autonomy level", () => {
    expect(parseAgentAutonomy("1")).toBe("1");
    expect(parseAgentAutonomy("2")).toBe("2");
    expect(parseAgentAutonomy("3")).toBe("3");
  });

  it("falls back to the default for unknown / null values", () => {
    expect(parseAgentAutonomy(null)).toBe(DEFAULT_AGENT_AUTONOMY);
    expect(parseAgentAutonomy(undefined)).toBe(DEFAULT_AGENT_AUTONOMY);
    expect(parseAgentAutonomy("")).toBe(DEFAULT_AGENT_AUTONOMY);
    expect(parseAgentAutonomy("4")).toBe(DEFAULT_AGENT_AUTONOMY);
    expect(parseAgentAutonomy("low")).toBe(DEFAULT_AGENT_AUTONOMY);
  });

  it("exposes one option per autonomy value", () => {
    const values = AGENT_AUTONOMY_OPTIONS.map((option) => option.value);
    expect(values).toEqual(["1", "2", "3"]);
  });
});
