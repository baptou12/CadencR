import { describe, it, expect } from "vitest";
import { buildBlocks } from "./shared";
import type { AgentMessageRow } from "../db/types";

function makeMessage(overrides: Partial<AgentMessageRow>): AgentMessageRow {
  return {
    id: 1,
    session_id: 1,
    role: "assistant",
    content: "",
    message_type: "text",
    tool_name: null,
    tool_use_id: null,
    parent_tool_use_id: null,
    created_at: "2026-01-01T00:00:00Z",
    model: null,
    ...overrides,
  };
}

describe("buildBlocks", () => {
  it("builds clear_divider block from clear_divider message", () => {
    const messages = [
      makeMessage({ id: 1, message_type: "text", role: "assistant", content: "Hello" }),
      makeMessage({ id: 2, message_type: "clear_divider", role: "system", content: "clear_boundary" }),
      makeMessage({ id: 3, message_type: "user_message", role: "user", content: "New message" }),
    ];
    const blocks = buildBlocks(messages);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: "text", content: "Hello" });
    expect(blocks[1]).toMatchObject({ type: "clear_divider", content: "" });
    expect(blocks[2]).toMatchObject({ type: "user_message", content: "New message" });
  });

  it("builds compact_divider block from compact_divider message", () => {
    const messages = [
      makeMessage({ id: 1, message_type: "compact_divider", role: "system", content: "" }),
    ];
    const blocks = buildBlocks(messages);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "compact_divider", content: "" });
  });
});
