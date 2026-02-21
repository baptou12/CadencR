import { describe, it, expect } from "vitest";
import { extractTextFromEvent } from "./utils";
import type { StreamEvent } from "./types";

describe("extractTextFromEvent", () => {
  it("returns text from content_block_start with text block", () => {
    const event = {
      type: "content_block_start",
      content_block: { type: "text", text: "hello" },
    } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBe("hello");
  });

  it("returns null from content_block_start with non-text block", () => {
    const event = {
      type: "content_block_start",
      content_block: { type: "tool_use", id: "x", name: "bash", input: {} },
    } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBeNull();
  });

  it("returns text from content_block_delta with text_delta", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: " world" },
    } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBe(" world");
  });

  it("returns null from content_block_delta with non-text delta", () => {
    const event = {
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: "{}" },
    } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBeNull();
  });

  it("returns null for message_start event", () => {
    const event = { type: "message_start" } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBeNull();
  });

  it("returns null for message_delta event", () => {
    const event = { type: "message_delta" } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBeNull();
  });

  it("returns null for message_stop event", () => {
    const event = { type: "message_stop" } as unknown as StreamEvent;
    expect(extractTextFromEvent(event)).toBeNull();
  });
});
