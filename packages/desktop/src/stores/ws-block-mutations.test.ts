import { describe, it, expect } from "vitest";
import { applyMutations, parseTodosFromBlocks } from "./ws-block-mutations";
import { createStreamingState } from "./ws-message-processing";
import type { AgentBlockData } from "@/components/AgentBlock";

describe("parseTodosFromBlocks", () => {
  it("extracts todos from the last TodoWrite block", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "text", content: "hello" },
      {
        id: "2",
        type: "tool_call",
        content: JSON.stringify({
          todos: [
            {
              content: "Fix bug",
              status: "in_progress",
              activeForm: "Fixing bug",
            },
            {
              content: "Write tests",
              status: "pending",
              activeForm: "Writing tests",
            },
          ],
        }),
        toolName: "TodoWrite",
        toolArgs: JSON.stringify({
          todos: [
            {
              content: "Fix bug",
              status: "in_progress",
              activeForm: "Fixing bug",
            },
            {
              content: "Write tests",
              status: "pending",
              activeForm: "Writing tests",
            },
          ],
        }),
      },
    ];
    const result = parseTodosFromBlocks(blocks);
    expect(result).toEqual([
      { content: "Fix bug", status: "in_progress", activeForm: "Fixing bug" },
      {
        content: "Write tests",
        status: "pending",
        activeForm: "Writing tests",
      },
    ]);
  });

  it("returns undefined when no TodoWrite block exists", () => {
    const blocks: AgentBlockData[] = [{ id: "1", type: "text", content: "hello" }];
    expect(parseTodosFromBlocks(blocks)).toBeUndefined();
  });

  it("extracts todos from child blocks", () => {
    const blocks: AgentBlockData[] = [
      {
        id: "agent-1",
        type: "tool_call",
        content: "",
        toolName: "Agent",
        childBlocks: [
          {
            id: "child-1",
            type: "tool_call",
            content: JSON.stringify({
              todos: [
                {
                  content: "Task A",
                  status: "completed",
                  activeForm: "Doing A",
                },
              ],
            }),
            toolName: "TodoWrite",
            toolArgs: JSON.stringify({
              todos: [
                {
                  content: "Task A",
                  status: "completed",
                  activeForm: "Doing A",
                },
              ],
            }),
          },
        ],
      },
    ];
    const result = parseTodosFromBlocks(blocks);
    expect(result).toEqual([{ content: "Task A", status: "completed", activeForm: "Doing A" }]);
  });

  it("returns undefined for malformed JSON", () => {
    const blocks: AgentBlockData[] = [
      {
        id: "1",
        type: "tool_call",
        content: "{bad json",
        toolName: "TodoWrite",
        toolArgs: "{bad json",
      },
    ];
    expect(parseTodosFromBlocks(blocks)).toBeUndefined();
  });
});

describe("applyMutations", () => {
  it("merges Bash output patches into the command args", () => {
    const streamState = createStreamingState();
    const previous = JSON.stringify({ command: "pwd" });
    const latest = JSON.stringify({ output: "/tmp/project\n" });
    const existing: AgentBlockData[] = [
      {
        id: "bash-1",
        type: "tool_call",
        content: previous,
        toolName: "Bash",
        toolArgs: previous,
        toolUseId: "tu-bash-1",
      },
    ];

    const result = applyMutations(
      existing,
      [
        {
          action: "update",
          block: {
            id: "bash-1",
            type: "tool_call",
            content: latest,
            toolName: "Bash",
          },
        },
      ],
      streamState,
    );

    expect(JSON.parse(result[0].content)).toEqual({
      command: "pwd",
      output: "/tmp/project\n",
    });
    expect(result[0].toolArgs).toBe(result[0].content);
  });

  it("merges ApplyPatch object deltas without dropping patch_text", () => {
    const streamState = createStreamingState();
    const previous = JSON.stringify({
      patch_text: "*** Begin Patch\n*** Update File: toto.txt\n@@\n-old\n+new\n*** End Patch",
      status: "running",
    });
    const latest = JSON.stringify({ output: "Success", status: "completed" });
    const existing: AgentBlockData[] = [
      {
        id: "patch-1",
        type: "tool_call",
        content: previous,
        toolName: "ApplyPatch",
        toolArgs: previous,
        toolUseId: "tu-patch-1",
      },
    ];

    const result = applyMutations(
      existing,
      [
        {
          action: "update",
          block: {
            id: "patch-1",
            type: "tool_call",
            content: latest,
            toolName: "ApplyPatch",
          },
        },
      ],
      streamState,
    );

    expect(JSON.parse(result[0].content)).toEqual({
      patch_text: "*** Begin Patch\n*** Update File: toto.txt\n@@\n-old\n+new\n*** End Patch",
      output: "Success",
      status: "completed",
    });
    expect(result[0].toolArgs).toBe(result[0].content);
  });

  it("recovers latest valid json snapshot for non-Bash concatenated updates", () => {
    const streamState = createStreamingState();
    const previous = JSON.stringify({ pattern: "old" });
    const latest = JSON.stringify({ pattern: "new" });
    const existing: AgentBlockData[] = [
      {
        id: "grep-1",
        type: "tool_call",
        content: previous,
        toolName: "Grep",
        toolArgs: previous,
      },
    ];

    const result = applyMutations(
      existing,
      [
        {
          action: "update",
          block: {
            id: "grep-1",
            type: "tool_call",
            content: latest,
            toolName: "Grep",
          },
        },
      ],
      streamState,
    );

    expect(result[0].content).toBe(previous + latest);
    expect(result[0].toolArgs).toBe(latest);
  });

  it("maintains rootBlocks and toolResultMap when a root block is appended", () => {
    const streamState = createStreamingState();
    const rootBlock: AgentBlockData = { id: "r1", type: "text", content: "hello" };
    applyMutations([], [{ action: "append", block: rootBlock }], streamState);
    expect(streamState.rootBlocks).toEqual([rootBlock]);
    expect(streamState.rootBlockPosById.get("r1")).toBe(0);

    const resultBlock: AgentBlockData = {
      id: "r2",
      type: "tool_result",
      content: "ok",
      toolUseId: "tu-1",
    };
    applyMutations([rootBlock], [{ action: "append", block: resultBlock }], streamState);
    expect(streamState.rootBlocks).toEqual([rootBlock, resultBlock]);
    expect(streamState.toolResultMap.get("tu-1")).toBe(resultBlock);
  });

  it("does not push child appends into rootBlocks but bumps the parent ref", () => {
    const streamState = createStreamingState();
    const parent: AgentBlockData = {
      id: "p1",
      type: "tool_call",
      content: "{}",
      toolName: "Agent",
      toolUseId: "tu-parent",
      childBlocks: [],
    };
    streamState.toolUseIdToBlock.set("tu-parent", parent);
    applyMutations([], [{ action: "append", block: parent }], streamState);
    expect(streamState.rootBlocks).toHaveLength(1);
    const initialParentRef = streamState.rootBlocks[0];
    expect(initialParentRef.id).toBe("p1");

    const child: AgentBlockData = {
      id: "c1",
      type: "text",
      content: "child text",
      parentToolUseId: "tu-parent",
    };
    applyMutations([parent], [{ action: "append", block: child }], streamState);
    // Child must NOT appear at root level.
    expect(streamState.rootBlocks).toHaveLength(1);
    expect(streamState.rootBlocks[0].id).toBe("p1");
    // Parent ref must have been swapped (replace_parent).
    expect(streamState.rootBlocks[0]).not.toBe(initialParentRef);
  });

  it("swaps the rootBlocks ref when a root block content is updated", () => {
    const streamState = createStreamingState();
    const root: AgentBlockData = { id: "t1", type: "text", content: "hi " };
    applyMutations([], [{ action: "append", block: root }], streamState);
    const initialRef = streamState.rootBlocks[0];

    const result = applyMutations(
      [root],
      [{ action: "update", block: { id: "t1", type: "text", content: "world" } }],
      streamState,
    );
    expect(result[0].content).toBe("hi world");
    expect(streamState.rootBlocks[0]).not.toBe(initialRef);
    expect(streamState.rootBlocks[0].content).toBe("hi world");
  });

  it("reconciles duplicate appends by block id instead of adding a second block", () => {
    const streamState = createStreamingState();
    const existing: AgentBlockData = { id: "msg-10", type: "text", content: "hello" };
    applyMutations([], [{ action: "append", block: existing }], streamState);

    const result = applyMutations(
      [existing],
      [{ action: "append", block: { id: "msg-10", type: "text", content: "" } }],
      streamState,
    );

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("hello");
    expect(streamState.rootBlocks).toHaveLength(1);
  });

  it("keeps existing children when a duplicate task append has an empty child list", () => {
    const streamState = createStreamingState();
    const task: AgentBlockData = {
      id: "task",
      type: "tool_call",
      content: "{}",
      toolName: "Agent",
      toolUseId: "task-tu",
      childBlocks: [{ id: "child", type: "text", content: "done" }],
    };
    applyMutations([], [{ action: "append", block: task }], streamState);
    const result = applyMutations(
      [task],
      [
        {
          action: "append",
          block: { ...task, content: "", childBlocks: [] },
        },
      ],
      streamState,
    );
    expect(result).toHaveLength(1);
    expect(result[0].childBlocks?.map((block) => block.id)).toEqual(["child"]);
  });

  it("skips no-op duplicate child appends instead of appending again", () => {
    const streamState = createStreamingState();
    const parent: AgentBlockData = {
      id: "parent",
      type: "tool_call",
      content: "{}",
      toolUseId: "tu-parent",
      childBlocks: [{ id: "child", type: "text", content: "already streamed" }],
    };
    applyMutations([], [{ action: "append", block: parent }], streamState);
    const initialParentRef = streamState.rootBlocks[0];
    const result = applyMutations(
      [parent],
      [
        {
          action: "append",
          block: {
            id: "child",
            type: "text",
            content: "",
            parentToolUseId: "tu-parent",
          },
        },
      ],
      streamState,
    );
    expect(result[0].childBlocks).toHaveLength(1);
    expect(result[0]).toBe(initialParentRef);
  });

  it("does not loop forever when partial json starts with '{'", () => {
    const streamState = createStreamingState();
    const validArgs = JSON.stringify({
      description: "Find files",
      prompt: "search",
    });
    const existing: AgentBlockData[] = [
      {
        id: "agent-1",
        type: "tool_call",
        content: validArgs,
        toolName: "Agent",
        toolArgs: validArgs,
      },
    ];

    const result = applyMutations(
      existing,
      [
        {
          action: "replace",
          block: {
            id: "agent-1",
            type: "tool_call",
            content: '{"description": "Fi',
            toolName: "Agent",
          },
        },
      ],
      streamState,
    );

    expect(result[0].toolArgs).toBe(validArgs);
    expect(result[0].content).toBe('{"description": "Fi');
  });
});
