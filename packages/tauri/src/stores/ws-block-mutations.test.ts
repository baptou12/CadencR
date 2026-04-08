import { describe, it, expect } from "vitest";
import { parseTodosFromBlocks, buildMessagePatch } from "./ws-block-mutations";
import { createStreamingState } from "./ws-message-processing";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { BlockMutation } from "./ws-message-processing";

describe("parseTodosFromBlocks", () => {
  it("extracts todos from the last TodoWrite block", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "text", content: "hello" },
      {
        id: "2", type: "tool_call", content: JSON.stringify({
          todos: [
            { content: "Fix bug", status: "in_progress", activeForm: "Fixing bug" },
            { content: "Write tests", status: "pending", activeForm: "Writing tests" },
          ],
        }),
        toolName: "TodoWrite",
        toolArgs: JSON.stringify({
          todos: [
            { content: "Fix bug", status: "in_progress", activeForm: "Fixing bug" },
            { content: "Write tests", status: "pending", activeForm: "Writing tests" },
          ],
        }),
      },
    ];
    const result = parseTodosFromBlocks(blocks);
    expect(result).toEqual([
      { content: "Fix bug", status: "in_progress", activeForm: "Fixing bug" },
      { content: "Write tests", status: "pending", activeForm: "Writing tests" },
    ]);
  });

  it("returns undefined when no TodoWrite block exists", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "text", content: "hello" },
    ];
    expect(parseTodosFromBlocks(blocks)).toBeUndefined();
  });

  it("extracts todos from child blocks", () => {
    const blocks: AgentBlockData[] = [
      {
        id: "agent-1", type: "tool_call", content: "", toolName: "Agent",
        childBlocks: [
          {
            id: "child-1", type: "tool_call",
            content: JSON.stringify({ todos: [{ content: "Task A", status: "completed", activeForm: "Doing A" }] }),
            toolName: "TodoWrite",
            toolArgs: JSON.stringify({ todos: [{ content: "Task A", status: "completed", activeForm: "Doing A" }] }),
          },
        ],
      },
    ];
    const result = parseTodosFromBlocks(blocks);
    expect(result).toEqual([{ content: "Task A", status: "completed", activeForm: "Doing A" }]);
  });

  it("returns undefined for malformed JSON", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "tool_call", content: "{bad json", toolName: "TodoWrite", toolArgs: "{bad json" },
    ];
    expect(parseTodosFromBlocks(blocks)).toBeUndefined();
  });
});

describe("buildMessagePatch", () => {
  it("detects file change tools", () => {
    const state = createStreamingState();
    const blocks: AgentBlockData[] = [
      { id: "b1", type: "tool_call", content: "", toolName: "Write" },
    ];
    const mutations: BlockMutation[] = [
      { action: "append", block: blocks[0] },
    ];
    const patch = buildMessagePatch(blocks, mutations, state);
    expect(patch.hasFileChanges).toBe(true);
    expect(patch.status).toBe("running");
  });

  it("does not set hasFileChanges for non-file tools", () => {
    const state = createStreamingState();
    const blocks: AgentBlockData[] = [
      { id: "b1", type: "tool_call", content: "", toolName: "Read" },
    ];
    const mutations: BlockMutation[] = [
      { action: "append", block: blocks[0] },
    ];
    const patch = buildMessagePatch(blocks, mutations, state);
    expect(patch.hasFileChanges).toBeUndefined();
  });

  it("detects enterPlanMode and sets permissionMode", () => {
    const state = createStreamingState();
    state.enterPlanModeDetected = true;
    const blocks: AgentBlockData[] = [];
    const mutations: BlockMutation[] = [];
    const patch = buildMessagePatch(blocks, mutations, state);
    expect(patch.permissionMode).toBe("plan");
    expect(state.enterPlanModeDetected).toBe(false);
  });

  it("extracts todos from mutated TodoWrite block", () => {
    const state = createStreamingState();
    const todoContent = JSON.stringify({
      todos: [{ content: "Do X", status: "pending", activeForm: "Doing X" }],
    });
    const blocks: AgentBlockData[] = [
      { id: "t1", type: "tool_call", content: todoContent, toolName: "TodoWrite", toolArgs: todoContent },
    ];
    const mutations: BlockMutation[] = [
      { action: "append", block: blocks[0] },
    ];
    const patch = buildMessagePatch(blocks, mutations, state);
    expect(patch.todos).toEqual([{ content: "Do X", status: "pending", activeForm: "Doing X" }]);
  });
});
