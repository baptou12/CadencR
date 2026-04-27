import { describe, it, expect } from "vitest";
import { applyMutations, parseTodosFromBlocks, buildMessagePatch } from "./ws-block-mutations";
import { createStreamingState } from "./ws-message-processing";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { BlockMutation } from "./ws-message-processing";

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

describe("buildMessagePatch", () => {
  it("detects file change tools", () => {
    const blocks: AgentBlockData[] = [
      { id: "b1", type: "tool_call", content: "", toolName: "Write" },
    ];
    const mutations: BlockMutation[] = [{ action: "append", block: blocks[0] }];
    const patch = buildMessagePatch(blocks, mutations, {
      enterPlanModeRequested: false,
    });
    expect(patch.hasFileChanges).toBe(true);
  });

  it("detects apply_patch as a file change tool", () => {
    const blocks: AgentBlockData[] = [
      { id: "b1", type: "tool_call", content: "", toolName: "apply_patch" },
    ];
    const mutations: BlockMutation[] = [{ action: "append", block: blocks[0] }];
    const patch = buildMessagePatch(blocks, mutations, {
      enterPlanModeRequested: false,
    });
    expect(patch.hasFileChanges).toBe(true);
  });

  it("does not set hasFileChanges for non-file tools", () => {
    const blocks: AgentBlockData[] = [
      { id: "b1", type: "tool_call", content: "", toolName: "Read" },
    ];
    const mutations: BlockMutation[] = [{ action: "append", block: blocks[0] }];
    const patch = buildMessagePatch(blocks, mutations, {
      enterPlanModeRequested: false,
    });
    expect(patch.hasFileChanges).toBeUndefined();
  });

  it("detects enterPlanMode and sets permissionMode", () => {
    const blocks: AgentBlockData[] = [];
    const mutations: BlockMutation[] = [];
    const patch = buildMessagePatch(blocks, mutations, {
      enterPlanModeRequested: true,
    });
    expect(patch.permissionMode).toBe("plan");
  });

  it("extracts todos from mutated TodoWrite block", () => {
    const todoContent = JSON.stringify({
      todos: [{ content: "Do X", status: "pending", activeForm: "Doing X" }],
    });
    const blocks: AgentBlockData[] = [
      {
        id: "t1",
        type: "tool_call",
        content: todoContent,
        toolName: "TodoWrite",
        toolArgs: todoContent,
      },
    ];
    const mutations: BlockMutation[] = [{ action: "append", block: blocks[0] }];
    const patch = buildMessagePatch(blocks, mutations, {
      enterPlanModeRequested: false,
    });
    expect(patch.todos).toEqual([{ content: "Do X", status: "pending", activeForm: "Doing X" }]);
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
