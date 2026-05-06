import { describe, it, expect } from "vitest";
import { blocksPatchWithDerived, rebuildDerivedAgentStreamState } from "./ws-block-mutations";
import { createStreamingState } from "./ws-message-processing";
import type { AgentBlockData } from "@/components/AgentBlock";

describe("rebuildDerivedAgentStreamState", () => {
  it("filters out children and indexes tool_result blocks by toolUseId", () => {
    const streamState = createStreamingState();
    const blocks: AgentBlockData[] = [
      { id: "a", type: "text", content: "hi" },
      { id: "b", type: "text", content: "child", parentToolUseId: "tu-x" },
      { id: "c", type: "tool_result", content: "ok", toolUseId: "tu-x" },
    ];
    rebuildDerivedAgentStreamState(streamState, blocks);
    expect(streamState.rootBlocks.map((b) => b.id)).toEqual(["a", "c"]);
    expect(streamState.toolResultMap.get("tu-x")?.id).toBe("c");
    expect(streamState.rootBlockPosById.get("a")).toBe(0);
    expect(streamState.rootBlockPosById.get("c")).toBe(1);
  });

  it("indexes nested tool calls so streamed children can reconcile after hydration", () => {
    const streamState = createStreamingState();
    const task: AgentBlockData = {
      id: "task",
      type: "tool_call",
      content: "{}",
      toolUseId: "task-1",
      childBlocks: [{ id: "child", type: "text", content: "nested" }],
    };
    rebuildDerivedAgentStreamState(streamState, [task]);
    expect(streamState.toolUseIdToBlock.get("task-1")).toBe(task);
  });
});

describe("blocksPatchWithDerived", () => {
  it("returns fresh refs for blocks, rootBlocks, and toolResultMap", () => {
    const streamState = createStreamingState();
    const blocks: AgentBlockData[] = [
      { id: "a", type: "text", content: "hi" },
      { id: "b", type: "tool_result", content: "ok", toolUseId: "tu-1" },
    ];
    const patch = blocksPatchWithDerived(streamState, blocks);
    expect(patch.blocks).toBe(blocks);
    expect(patch.rootBlocks).not.toBe(streamState.rootBlocks);
    expect(patch.rootBlocks.map((b) => b.id)).toEqual(["a", "b"]);
    expect(patch.toolResultMap).not.toBe(streamState.toolResultMap);
    expect(patch.toolResultMap.get("tu-1")?.id).toBe("b");
  });
});
