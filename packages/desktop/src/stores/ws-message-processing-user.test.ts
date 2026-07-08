import { describe, expect, it } from "vitest";

import type { AgentBlockData } from "@/components/AgentBlock";
import { createStreamingState, type ParserSignals } from "./ws-message-processing";
import { processUserMessage } from "./ws-message-processing-user";

function signals(): ParserSignals {
  return {
    enterPlanModeRequested: false,
    compactBoundaryObserved: false,
    compactBoundaryTrigger: null,
  };
}

function taskResultMessage(toolUseId: string, content: unknown = "done") {
  return {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
  };
}

/** The internal metadata Claude returns when it launches a subagent async. */
const LAUNCH_ACK = [
  {
    type: "text",
    text: "Async agent launched successfully. agentId: abc123. The agent is working in the background. You will be notified automatically when it completes.",
  },
];

describe("processUserMessage subagent completion", () => {
  it("marks the Task/Agent tool_call complete when its own tool_result arrives", () => {
    const state = createStreamingState();
    const task: AgentBlockData = {
      id: "block-task",
      type: "tool_call",
      content: "",
      toolName: "Agent",
      toolUseId: "toolu_task",
      childBlocks: [],
      taskComplete: false,
    };
    state.toolUseIdToBlock.set("toolu_task", task);

    const mutations = processUserMessage(taskResultMessage("toolu_task"), state, signals());

    expect(task.taskComplete).toBe(true);
    // The result is re-nested under the Task (parentToolUseId === its own id).
    expect(mutations).toHaveLength(1);
    expect(mutations[0].block.parentToolUseId).toBe("toolu_task");
  });

  it("does NOT complete a background subagent on its launch ack, and skips the ack block", () => {
    const state = createStreamingState();
    const task: AgentBlockData = {
      id: "block-task",
      type: "tool_call",
      content: "",
      toolName: "Agent",
      toolUseId: "toolu_task",
      childBlocks: [],
      taskComplete: false,
    };
    state.toolUseIdToBlock.set("toolu_task", task);

    const mutations = processUserMessage(
      taskResultMessage("toolu_task", LAUNCH_ACK),
      state,
      signals(),
    );

    // The subagent is still running in the background — do not complete it.
    expect(task.taskComplete).toBe(false);
    expect(task.taskBackground).toBe(true);
    // The "Async agent launched" internal metadata must not render.
    expect(mutations).toHaveLength(0);
  });

  it("leaves taskComplete untouched for a non-subagent tool_result", () => {
    const state = createStreamingState();
    const bash: AgentBlockData = {
      id: "block-bash",
      type: "tool_call",
      content: "",
      toolName: "Bash",
      toolUseId: "toolu_bash",
      taskComplete: false,
    };
    state.toolUseIdToBlock.set("toolu_bash", bash);

    processUserMessage(taskResultMessage("toolu_bash"), state, signals());

    expect(bash.taskComplete).toBe(false);
  });
});
