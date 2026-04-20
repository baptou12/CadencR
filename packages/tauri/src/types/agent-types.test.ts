import { describe, it, expect } from "vitest";
import { buildUserMessageContent, extractUserMessageText, parseUserMessageContent } from "./agent-types";

describe("buildUserMessageContent", () => {
  it("returns plain text when no images", () => {
    expect(buildUserMessageContent("hello")).toBe("hello");
  });

  it("returns plain text when images array is empty", () => {
    expect(buildUserMessageContent("hello", [])).toBe("hello");
  });

  it("returns JSON with text and image blocks when images provided", () => {
    const result = buildUserMessageContent("describe this", [
      { base64: "abc123", mimeType: "image/png" },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ type: "text", text: "describe this" });
    expect(parsed[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "abc123" },
    });
  });

  it("handles multiple images", () => {
    const result = buildUserMessageContent("two images", [
      { base64: "img1", mimeType: "image/png" },
      { base64: "img2", mimeType: "image/jpeg" },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(3);
    expect(parsed[1].source.data).toBe("img1");
    expect(parsed[2].source.media_type).toBe("image/jpeg");
  });

  it("returns undefined images as plain text", () => {
    expect(buildUserMessageContent("test", undefined)).toBe("test");
  });

  it("extracts text and images from persisted user messages", () => {
    const content = JSON.stringify([
      { type: "text", text: "Describe this screenshot" },
      { type: "image", source: { media_type: "image/png", data: "abc" } },
    ]);

    expect(parseUserMessageContent(content)).toEqual({
      text: "Describe this screenshot",
      images: [{ mediaType: "image/png", data: "abc" }],
    });
    expect(extractUserMessageText(content)).toBe("Describe this screenshot");
  });

  it("falls back to plain text when persisted content is not valid JSON", () => {
    expect(parseUserMessageContent("plain prompt")).toEqual({
      text: "plain prompt",
      images: [],
    });
  });
});
