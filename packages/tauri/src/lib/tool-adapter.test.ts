import { describe, expect, it } from "vitest";
import {
  extractBashOutput,
  isToolCallRunning,
  extractInlineDiffPreview,
  isFileChangeTool,
  normalizeToolName,
} from "./tool-adapter";

describe("normalizeToolName", () => {
  it("normalizes apply_patch aliases to ApplyPatch", () => {
    expect(normalizeToolName("apply_patch")).toBe("ApplyPatch");
    expect(normalizeToolName("ApplyPatch")).toBe("ApplyPatch");
  });
});

describe("isFileChangeTool", () => {
  it("treats ApplyPatch alias as file-changing", () => {
    expect(isFileChangeTool("apply_patch")).toBe(true);
    expect(isFileChangeTool("ApplyPatch")).toBe(true);
    expect(isFileChangeTool("Read")).toBe(false);
  });
});

describe("extractBashOutput", () => {
  it("extracts generic output field", () => {
    expect(extractBashOutput(JSON.stringify({ command: "pwd", output: "/tmp/project\n" }))).toBe("/tmp/project\n");
  });

  it("supports legacy persisted opencode output field", () => {
    expect(extractBashOutput(JSON.stringify({ command: "pwd", __opencode_output: "/tmp/old\n" }))).toBe("/tmp/old\n");
  });

  it("extracts structured stdout output", () => {
    expect(extractBashOutput(JSON.stringify({ output: { stdout: "ok\n", stderr: "" } }))).toBe("ok\n");
  });
});

describe("isToolCallRunning", () => {
  it("treats missing status as running", () => {
    expect(isToolCallRunning(JSON.stringify({ command: "ls" }))).toBe(true);
  });

  it("treats completed status as not running", () => {
    expect(isToolCallRunning(JSON.stringify({ status: "completed" }))).toBe(false);
  });
});

describe("extractInlineDiffPreview", () => {
  it("extracts patch preview from apply_patch args", () => {
    expect(
      extractInlineDiffPreview(
        "apply_patch",
        JSON.stringify({
          patch_text: "*** Begin Patch\n*** Add File: toto.txt\n+hello\n*** End Patch\n",
        }),
      ),
    ).toEqual({
      filePath: "toto.txt",
      oldContent: "",
      newContent: "hello",
    });
  });

  it("extracts update preview from ApplyPatch args", () => {
    expect(
      extractInlineDiffPreview(
        "ApplyPatch",
        JSON.stringify({
          patch_text: "*** Begin Patch\n*** Update File: /workspace/toto.txt\n@@\n-Hello Cadence\n+Hello Cadence 2\n*** End Patch",
        }),
      ),
    ).toEqual({
      filePath: "/workspace/toto.txt",
      oldContent: "Hello Cadence",
      newContent: "Hello Cadence 2",
    });
  });
});
