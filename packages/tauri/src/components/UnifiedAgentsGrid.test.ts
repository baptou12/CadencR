import { describe, expect, it } from "vitest";
import {
  buildUnifiedAgentPanelId,
  buildUnifiedAgentsRowLayoutKey,
  parseUnifiedAgentsRowHeights,
  parseUnifiedAgentsRowWidths,
} from "./UnifiedAgentsGrid";

describe("UnifiedAgentsGrid persistence helpers", () => {
  it("keys rows by columns and ordered session ids", () => {
    const key = buildUnifiedAgentsRowLayoutKey(2, [101, 202]);

    expect(key).toBe("columns:2|sessions:101,202");
    expect(buildUnifiedAgentsRowLayoutKey(3, [101, 202])).not.toBe(key);
    expect(buildUnifiedAgentsRowLayoutKey(2, [202, 101])).not.toBe(key);
  });

  it("builds stable panel ids from persisted entity ids", () => {
    expect(buildUnifiedAgentPanelId(7, 11, 13)).toBe("agent-7-11-13");
  });

  it("parses and clamps stored row heights", () => {
    expect(
      parseUnifiedAgentsRowHeights({
        "columns:2|sessions:101,202": 100,
        "columns:2|sessions:303,404": 1300,
        invalid: "640",
        nan: Number.NaN,
      }),
    ).toEqual({
      "columns:2|sessions:101,202": 420,
      "columns:2|sessions:303,404": 1200,
    });
  });

  it("parses stored row width layouts and drops invalid sizes", () => {
    expect(
      parseUnifiedAgentsRowWidths({
        "columns:2|sessions:101,202": {
          "agent-1-2-101": 33.3,
          "agent-1-2-202": 66.7,
          "agent-1-2-303": 101,
        },
        "columns:2|sessions:303,404": {
          "agent-1-2-303": -1,
        },
        invalid: "not-a-layout",
      }),
    ).toEqual({
      "columns:2|sessions:101,202": {
        "agent-1-2-101": 33.3,
        "agent-1-2-202": 66.7,
      },
    });
  });
});
