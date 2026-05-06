import { describe, expect, it } from "vitest";
import { getLatestUserPromptText } from "./getLatestUserPromptText";
import type { AgentBlockData } from "@/components/AgentBlock";

describe("getLatestUserPromptText", () => {
  it("returns the latest plain-text user message", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "user_message", content: "First prompt" },
      { id: "2", type: "text", content: "assistant" },
      { id: "3", type: "user_message", content: "Latest prompt" },
    ];

    expect(getLatestUserPromptText(blocks)).toBe("Latest prompt");
  });

  it("extracts text from JSON user messages with images", () => {
    const blocks: AgentBlockData[] = [
      {
        id: "1",
        type: "user_message",
        content: JSON.stringify([
          { type: "text", text: "Describe this screenshot" },
          { type: "image", source: { media_type: "image/png", data: "abc" } },
        ]),
      },
    ];

    expect(getLatestUserPromptText(blocks)).toBe("Describe this screenshot");
  });

  it("skips synthetic approval messages", () => {
    const blocks: AgentBlockData[] = [
      { id: "1", type: "user_message", content: "Build the feature" },
      { id: "2", type: "user_message", content: "Plan approved." },
    ];

    expect(getLatestUserPromptText(blocks)).toBe("Build the feature");
  });
});
