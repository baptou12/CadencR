import { describe, expect, it } from "vitest";
import { semanticSkillPresentation, shouldHideToolCall } from "./tool-display-policy";

describe("tool display policy", () => {
  it("hides runtime plumbing without hiding shared discovery tools", () => {
    expect(shouldHideToolCall("update_plan")).toBe(true);
    expect(shouldHideToolCall("wait")).toBe(true);
    expect(shouldHideToolCall("collaboration__wait_agent")).toBe(true);
    expect(shouldHideToolCall("ToolSearch")).toBe(false);
  });

  it("recognizes self-describing skill reads and sanitizes their arguments", () => {
    expect(
      semanticSkillPresentation(
        "Read",
        JSON.stringify({
          type: "read",
          command: "cat .agents/skills/db/SKILL.md",
          path: "/repo/.agents/skills/db/SKILL.md",
          file_path: "/repo/.agents/skills/db/SKILL.md",
        }),
      ),
    ).toEqual({ name: "db", args: JSON.stringify({ skill: "db" }) });
  });

  it("does not reclassify ordinary provider Read calls", () => {
    expect(
      semanticSkillPresentation(
        "Read",
        JSON.stringify({ file_path: "/repo/.agents/skills/db/SKILL.md" }),
      ),
    ).toBeUndefined();
    expect(
      semanticSkillPresentation(
        "Read",
        JSON.stringify({ type: "read", command: "cat README.md", path: "/repo/README.md" }),
      ),
    ).toBeUndefined();
  });
});
