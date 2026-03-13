import { describe, it, expect } from "vitest";
import { parseToolCall, getToolActivityLabel } from "./tool-call-parser";

describe("parseToolCall", () => {
  it("returns undefined for unknown tool", () => {
    expect(parseToolCall("UnknownTool")).toBeUndefined();
  });

  it("parses Read tool with file_path", () => {
    const result = parseToolCall("Read", JSON.stringify({ file_path: "src/main.ts" }));
    expect(result).toEqual({ label: "Reading file", detail: "src/main.ts" });
  });

  it("parses Write tool with file_path", () => {
    const result = parseToolCall("Write", JSON.stringify({ file_path: "src/out.ts" }));
    expect(result).toEqual({ label: "Writing file", detail: "src/out.ts" });
  });

  it("parses Edit tool with file_path", () => {
    const result = parseToolCall("Edit", JSON.stringify({ file_path: "src/edit.ts" }));
    expect(result).toEqual({ label: "Editing file", detail: "src/edit.ts" });
  });

  it("parses Bash tool with command", () => {
    const result = parseToolCall("Bash", JSON.stringify({ command: "git status" }));
    expect(result).toEqual({ label: "Running command", detail: "git status" });
  });

  it("parses Task tool with description", () => {
    const result = parseToolCall("Task", JSON.stringify({ description: "Find agent files" }));
    expect(result).toEqual({ label: "Running subtask", detail: "Find agent files" });
  });

  it("parses Agent tool with description (same as Task)", () => {
    const result = parseToolCall("Agent", JSON.stringify({ description: "Find agent files" }));
    expect(result).toEqual({ label: "Running subtask", detail: "Find agent files" });
  });

  it("parses Glob tool with pattern only", () => {
    const result = parseToolCall("Glob", JSON.stringify({ pattern: "**/*.ts" }));
    expect(result).toEqual({ label: "Finding files", detail: "**/*.ts" });
  });

  it("parses Glob tool with pattern and path", () => {
    const result = parseToolCall("Glob", JSON.stringify({ pattern: "*.ts", path: "src/" }));
    expect(result).toEqual({ label: "Finding files", detail: "*.ts in src/" });
  });

  it("parses Grep tool with pattern", () => {
    const result = parseToolCall("Grep", JSON.stringify({ pattern: "useState" }));
    expect(result).toEqual({ label: "Searching code", detail: "useState" });
  });

  it("parses Grep tool with pattern, type, and path", () => {
    const result = parseToolCall("Grep", JSON.stringify({ pattern: "foo", type: "ts", path: "src/" }));
    expect(result).toEqual({ label: "Searching code", detail: "foo (ts) in src/" });
  });

  it("parses WebSearch tool", () => {
    const result = parseToolCall("WebSearch", JSON.stringify({ query: "react hooks" }));
    expect(result).toEqual({ label: "Searching web", detail: "react hooks" });
  });

  it("parses WebFetch tool", () => {
    const result = parseToolCall("WebFetch", JSON.stringify({ url: "https://example.com" }));
    expect(result).toEqual({ label: "Fetching page", detail: "https://example.com" });
  });

  it("parses ExitPlanMode with no detail", () => {
    const result = parseToolCall("ExitPlanMode");
    expect(result).toEqual({ label: "Plan ready for review" });
  });

  it("handles malformed JSON args gracefully", () => {
    const result = parseToolCall("Read", "{invalid json");
    expect(result).toBeDefined();
    expect(result!.label).toBe("Reading file");
    expect(result!.detail).toBeUndefined();
  });

  it("handles missing args gracefully", () => {
    const result = parseToolCall("Read");
    expect(result).toEqual({ label: "Reading file", detail: undefined });
  });

  it("handles args with wrong types gracefully", () => {
    const result = parseToolCall("Read", JSON.stringify({ file_path: 123 }));
    expect(result).toEqual({ label: "Reading file", detail: undefined });
  });
});

describe("getToolActivityLabel", () => {
  it("returns label with detail when detail is present", () => {
    expect(getToolActivityLabel("Read", JSON.stringify({ file_path: "foo.ts" }))).toBe("Reading file: foo.ts");
  });

  it("returns label only when no detail", () => {
    expect(getToolActivityLabel("ExitPlanMode")).toBe("Plan ready for review");
  });

  it("returns 'Running <toolName>' for unknown tools", () => {
    expect(getToolActivityLabel("UnknownTool")).toBe("Running UnknownTool");
  });
});
