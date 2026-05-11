import { describe, expect, it } from "vitest";
import type { AgentBlockData } from "./AgentBlock";
import {
  buildDisplayBlockKeys,
  countRenderableDisplayRows,
  deriveAgentStreamDisplayBlocks,
  filterRenderableBlocks,
} from "./agentStreamDisplay";

function block(id: string, content: string, extra: Partial<AgentBlockData> = {}): AgentBlockData {
  return { id, type: "text", content, ...extra };
}

describe("agentStreamDisplay", () => {
  it("filters rows the renderer returns null for", () => {
    const visibleText = block("text", "visible");
    const emptyThinking = block("empty-thinking", "", { type: "thinking" });
    const hiddenToolResult = block("hidden-result", "read output", {
      type: "tool_result",
      sourceToolName: "Read",
    });

    expect(filterRenderableBlocks([visibleText, emptyThinking, hiddenToolResult])).toEqual([
      visibleText,
    ]);
  });

  it("keeps only Agent and Task tool results that render standalone", () => {
    const bashResult = block("bash", "bash output", {
      type: "tool_result",
      sourceToolName: "Bash",
    });
    const taskResult = block("task", "task output", {
      type: "tool_result",
      sourceToolName: "Task",
    });
    const editResult = block("edit", "changed file", {
      type: "tool_result",
      sourceToolName: "Edit",
    });

    expect(filterRenderableBlocks([bashResult, taskResult, editResult])).toEqual([taskResult]);
  });

  it("excludes child rows from the root agent stream display", () => {
    const root = block("root", "root");
    const child = block("child", "child", { parentToolUseId: "task-1" });

    expect(deriveAgentStreamDisplayBlocks([root, child])).toEqual([root]);
  });

  it("does not merge a prepended text block into the previously first visible row", () => {
    const createdAt = "2026-04-12T12:09:36Z";
    const previousFirst = block("current-first", "current", {
      createdAt,
      model: "openai/gpt-5.3-codex",
    });
    const prepended = block("older", "older", {
      createdAt,
      model: "openai/gpt-5.3-codex",
    });

    const displayBlocks = deriveAgentStreamDisplayBlocks([prepended, previousFirst]);

    expect(displayBlocks.map((item) => item.id)).toEqual(["older", "current-first"]);
    expect(buildDisplayBlockKeys(displayBlocks)).toEqual(["older", "current-first"]);
    expect(displayBlocks[1]).toBe(previousFirst);
  });

  it("builds deterministic keys when duplicate block ids are visible", () => {
    const first = block("dup", "first");
    const second = block("dup", "second");
    const unique = block("unique", "unique");

    expect(buildDisplayBlockKeys([first, second, unique])).toEqual(["dup#0", "dup#1", "unique"]);
  });

  it("counts prepended rows after filtering hidden rows and child rows", () => {
    const current = [block("current", "current")];
    const next = [
      block("hidden", "hidden", { type: "tool_result", sourceToolName: "Read" }),
      block("child", "child", { parentToolUseId: "task-1" }),
      block("older-1", "older 1"),
      block("older-2", "older 2", { type: "thinking", content: "thinking" }),
      ...current,
    ];

    expect(countRenderableDisplayRows(next.slice(0, -current.length))).toBe(2);
  });

  it("returns zero renderable rows for batches that only contain hidden rows", () => {
    expect(
      countRenderableDisplayRows([
        block("hidden", "hidden", { type: "tool_result", sourceToolName: "Read" }),
        block("child", "child", { parentToolUseId: "task-1" }),
      ]),
    ).toBe(0);
  });
});
