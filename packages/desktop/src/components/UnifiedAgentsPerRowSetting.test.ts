import { describe, expect, it } from "vitest";
import { parseUnifiedAgentsPerRowSetting } from "@/components/UnifiedAgentsPerRowSetting";

describe("UnifiedAgentsPerRowSetting", () => {
  it("defaults invalid persisted values and clamps the row count", () => {
    expect(parseUnifiedAgentsPerRowSetting(null)).toBe(3);
    expect(parseUnifiedAgentsPerRowSetting("not-a-number")).toBe(3);
    expect(parseUnifiedAgentsPerRowSetting("0")).toBe(1);
    expect(parseUnifiedAgentsPerRowSetting("7")).toBe(6);
  });

  it("normalizes fractional values to whole columns", () => {
    expect(parseUnifiedAgentsPerRowSetting("4.9")).toBe(4);
  });
});
