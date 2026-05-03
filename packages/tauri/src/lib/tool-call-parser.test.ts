import { describe, it, expect } from "vitest";
import { parseToolCall, getToolActivityLabel, parseCadencrMcpTool } from "./tool-call-parser";

describe("parseToolCall", () => {
  it("returns undefined for unknown tool", () => {
    expect(parseToolCall("UnknownTool")).toBeUndefined();
  });

  it("parses Read tool with file_path", () => {
    const result = parseToolCall("Read", JSON.stringify({ file_path: "src/main.ts" }));
    expect(result).toEqual({ label: "Reading file", detail: "src/main.ts" });
  });

  it("parses LS tool with path", () => {
    const result = parseToolCall("LS", JSON.stringify({ path: "src" }));
    expect(result).toEqual({ label: "Listing files", detail: "src" });
  });

  it("parses Write tool with file_path", () => {
    const result = parseToolCall("Write", JSON.stringify({ file_path: "src/out.ts" }));
    expect(result).toEqual({ label: "Writing file", detail: "src/out.ts" });
  });

  it("parses Edit tool with file_path", () => {
    const result = parseToolCall("Edit", JSON.stringify({ file_path: "src/edit.ts" }));
    expect(result).toEqual({ label: "Editing file", detail: "src/edit.ts" });
  });

  it("parses apply_patch tool with patchText", () => {
    const result = parseToolCall(
      "apply_patch",
      JSON.stringify({
        patchText: "*** Begin Patch\n*** Add File: toto.txt\n+hello\n*** End Patch\n",
      }),
    );
    expect(result).toEqual({ label: "Applying patch", detail: "toto.txt" });
  });

  it("parses Bash tool with command", () => {
    const result = parseToolCall("Bash", JSON.stringify({ command: "git status" }));
    expect(result).toEqual({ label: "Running command", detail: "git status" });
  });

  it("parses Codex exec_command with cmd", () => {
    const result = parseToolCall("exec_command", JSON.stringify({ cmd: "pnpm test" }));
    expect(result).toEqual({ label: "Starting terminal command", detail: "pnpm test" });
  });

  it("parses Codex write_stdin polling", () => {
    const result = parseToolCall("write_stdin", JSON.stringify({ session_id: 42, chars: "" }));
    expect(result).toEqual({
      label: "Writing to terminal",
      detail: "poll session 42",
    });
  });

  it("parses Codex write_stdin interrupt", () => {
    const result = parseToolCall(
      "write_stdin",
      JSON.stringify({ session_id: 42, chars: "\u0003" }),
    );
    expect(result).toEqual({
      label: "Writing to terminal",
      detail: "interrupt session 42",
    });
  });

  it("parses Codex write_stdin typed input without exposing content", () => {
    const result = parseToolCall("write_stdin", JSON.stringify({ session_id: 42, chars: "yes\n" }));
    expect(result).toEqual({
      label: "Writing to terminal",
      detail: "send 4 chars to session 42",
    });
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
    const result = parseToolCall(
      "Grep",
      JSON.stringify({ pattern: "foo", type: "ts", path: "src/" }),
    );
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

  it("handles null args gracefully", () => {
    const result = parseToolCall("Edit", "null");
    expect(result).toEqual({ label: "Editing file", detail: undefined });
  });

  it("handles args with wrong types gracefully", () => {
    const result = parseToolCall("Read", JSON.stringify({ file_path: 123 }));
    expect(result).toEqual({ label: "Reading file", detail: undefined });
  });
});

describe("getToolActivityLabel", () => {
  it("returns label with detail when detail is present", () => {
    expect(getToolActivityLabel("Read", JSON.stringify({ file_path: "foo.ts" }))).toBe(
      "Reading file: foo.ts",
    );
  });

  it("returns patch activity label for apply_patch", () => {
    expect(
      getToolActivityLabel(
        "apply_patch",
        JSON.stringify({
          patchText: "*** Begin Patch\n*** Add File: toto.txt\n+hello\n*** End Patch\n",
        }),
      ),
    ).toBe("Applying patch: toto.txt");
  });

  it("returns label only when no detail", () => {
    expect(getToolActivityLabel("ExitPlanMode")).toBe("Plan ready for review");
  });

  it("returns Codex write_stdin activity label", () => {
    expect(
      getToolActivityLabel("write_stdin", JSON.stringify({ session_id: "abc", chars: "\u0004" })),
    ).toBe("Writing to terminal: send EOF to session abc");
  });

  it("returns 'Running <toolName>' for unknown tools", () => {
    expect(getToolActivityLabel("UnknownTool")).toBe("Running UnknownTool");
  });

  it("returns prefixed label for Cadencr MCP tools", () => {
    expect(
      getToolActivityLabel(
        "mcp__cadencr-plan__create_phase",
        JSON.stringify({ title: "Setup DB" }),
      ),
    ).toBe("[plan] Creating phase: Setup DB");
  });

  it("returns prefixed label without detail for Cadencr MCP tools", () => {
    expect(getToolActivityLabel("mcp__cadencr-prd__read_prd")).toBe("[prd] Reading PRD");
  });
});

describe("parseCadencrMcpTool", () => {
  it("returns undefined for non-cadencr tool", () => {
    expect(parseCadencrMcpTool("Read")).toBeUndefined();
    expect(parseCadencrMcpTool("mcp__chrome-devtools__click")).toBeUndefined();
  });

  it("parses server and tool from cadencr MCP tool name", () => {
    const result = parseCadencrMcpTool("mcp__cadencr-plan__create_phase");
    expect(result).toBeDefined();
    expect(result!.server).toBe("plan");
    expect(result!.tool).toBe("create_phase");
  });

  it("returns known human-readable label", () => {
    expect(parseCadencrMcpTool("mcp__cadencr-plan__create_phase")!.label).toBe("Creating phase");
    expect(parseCadencrMcpTool("mcp__cadencr-prd__show_prd")!.label).toBe("Showing PRD");
    expect(parseCadencrMcpTool("mcp__cadencr-common__mark_agent_done")!.label).toBe("Marking done");
  });

  it("title-cases unknown tool names as fallback", () => {
    expect(parseCadencrMcpTool("mcp__cadencr-plan__do_something_new")!.label).toBe(
      "Do Something New",
    );
  });

  it("extracts title from args as detail", () => {
    const result = parseCadencrMcpTool(
      "mcp__cadencr-plan__create_phase",
      JSON.stringify({ title: "Setup DB" }),
    );
    expect(result!.detail).toBe("Setup DB");
  });

  it("extracts phase_id as detail for read_phase", () => {
    const result = parseCadencrMcpTool(
      "mcp__cadencr-execute__read_phase",
      JSON.stringify({ phase_id: 42 }),
    );
    expect(result!.detail).toBe("Phase #42");
  });

  it("handles missing args gracefully", () => {
    const result = parseCadencrMcpTool("mcp__cadencr-plan__list_phases");
    expect(result).toBeDefined();
    expect(result!.detail).toBeUndefined();
  });

  it("handles malformed JSON args", () => {
    const result = parseCadencrMcpTool("mcp__cadencr-plan__read_plan", "{bad json");
    expect(result).toBeDefined();
    expect(result!.label).toBe("Reading plan");
    expect(result!.detail).toBeUndefined();
  });

  it("handles null args", () => {
    const result = parseCadencrMcpTool("mcp__cadencr-plan__read_plan", "null");
    expect(result).toBeDefined();
    expect(result!.label).toBe("Reading plan");
    expect(result!.detail).toBeUndefined();
  });

  it("falls back past empty-string title to summary", () => {
    const result = parseCadencrMcpTool(
      "mcp__cadencr-common__mark_agent_done",
      JSON.stringify({ title: "", summary: "Explored the theme" }),
    );
    expect(result!.detail).toBe("Explored the theme");
  });

  it("falls back past empty title/summary to commit_message", () => {
    const result = parseCadencrMcpTool(
      "mcp__cadencr-plan__create_phase",
      JSON.stringify({ title: "", summary: "", commit_message: "feat: add one-dark theme" }),
    );
    expect(result!.detail).toBe("feat: add one-dark theme");
  });

  it("falls back to truncated prompt when title/summary/commit_message are empty", () => {
    const longPrompt = "a".repeat(120);
    const result = parseCadencrMcpTool(
      "mcp__cadencr-plan__create_phase",
      JSON.stringify({ title: "", prompt: longPrompt }),
    );
    expect(result!.detail).toHaveLength(80);
  });
});
