import { describe, expect, it } from "vitest";
import type { AgentBlockData } from "@/components/AgentBlock";
import { markPromptReceived, movePendingPromptBlocksToTail } from "./ws-pending-prompts";

function block(
  id: string,
  type: AgentBlockData["type"] = "text",
  pendingClientId?: string,
): AgentBlockData {
  return {
    id,
    type,
    content: id,
    isError: false,
    ...(pendingClientId
      ? {
          clientMessageId: pendingClientId,
          promptDeliveryState: "pending_agent" as const,
        }
      : {}),
  };
}

describe("pending prompt delivery ordering", () => {
  it("keeps unreceived steering messages at the conversation tail", () => {
    const pending = block("user-1", "user_message", "client-1");

    const reordered = movePendingPromptBlocksToTail([
      block("assistant-1"),
      pending,
      block("tool-1", "tool_call"),
      block("assistant-2"),
    ]);

    expect(reordered.map((item) => item.id)).toEqual([
      "assistant-1",
      "tool-1",
      "assistant-2",
      "user-1",
    ]);
  });

  it("only tail-pins steering messages that have not been received yet", () => {
    const received = markPromptReceived(
      [
        block("assistant-1"),
        block("user-1", "user_message", "client-1"),
        block("user-2", "user_message", "client-2"),
      ],
      "client-1",
    );

    const reordered = movePendingPromptBlocksToTail([...received, block("assistant-2")]);

    expect(reordered.map((item) => item.id)).toEqual([
      "assistant-1",
      "user-1",
      "assistant-2",
      "user-2",
    ]);
    expect(reordered[1].promptDeliveryState).toBeUndefined();
    expect(reordered[3].promptDeliveryState).toBe("pending_agent");
  });
});
