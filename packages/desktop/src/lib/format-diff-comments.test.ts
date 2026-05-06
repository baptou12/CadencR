import { describe, it, expect } from "vitest";
import { formatCommentsForAgent } from "./format-diff-comments";

describe("formatCommentsForAgent", () => {
  it("returns empty string for no comments", () => {
    expect(formatCommentsForAgent([])).toBe("");
  });

  it("formats a single comment", () => {
    const result = formatCommentsForAgent([
      { file_path: "src/main.ts", line_number: 10, content: "Fix this" },
    ]);
    expect(result).toBe("## src/main.ts\n- Line 10: Fix this");
  });

  it("groups comments by file path", () => {
    const result = formatCommentsForAgent([
      { file_path: "a.ts", line_number: 1, content: "first" },
      { file_path: "b.ts", line_number: 5, content: "second" },
      { file_path: "a.ts", line_number: 3, content: "third" },
    ]);
    expect(result).toBe("## a.ts\n- Line 1: first\n- Line 3: third\n## b.ts\n- Line 5: second");
  });
});
