import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyAs, toPlainText, toSlackMrkdwn } from "./markdown-export";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("sonner", () => ({ toast }));

describe("toPlainText", () => {
  it("strips headings", () => {
    expect(toPlainText("# Hello\n## World")).toBe("Hello\nWorld");
  });

  it("strips bold and italic", () => {
    expect(toPlainText("**bold** and *italic* and _it_")).toBe("bold and italic and it");
  });

  it("strips inline code and fences", () => {
    expect(toPlainText("Use `foo` here")).toBe("Use foo here");
    expect(toPlainText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("flattens links and images to text", () => {
    expect(toPlainText("See [docs](https://example.com)")).toBe("See docs");
    expect(toPlainText("![alt](https://example.com/img.png)")).toBe("alt");
  });

  it("strips list bullets and blockquotes", () => {
    expect(toPlainText("- one\n- two\n> quote")).toBe("one\ntwo\nquote");
    expect(toPlainText("1. first\n2. second")).toBe("first\nsecond");
  });

  it("strips strikethrough", () => {
    expect(toPlainText("~~gone~~")).toBe("gone");
  });
});

describe("toSlackMrkdwn", () => {
  it("converts bold ** to single asterisk", () => {
    expect(toSlackMrkdwn("**hello**")).toBe("*hello*");
  });

  it("converts italic single asterisk to underscore", () => {
    // `*italic*` → `_italic_` (Slack uses underscores for italic)
    expect(toSlackMrkdwn("plain *italic* text")).toBe("plain _italic_ text");
  });

  it("converts headings to bold", () => {
    expect(toSlackMrkdwn("# Title")).toBe("*Title*");
    expect(toSlackMrkdwn("### Sub")).toBe("*Sub*");
  });

  it("converts links to <url|text>", () => {
    expect(toSlackMrkdwn("[GH](https://github.com)")).toBe("<https://github.com|GH>");
  });

  it("converts strikethrough to single tilde", () => {
    expect(toSlackMrkdwn("~~bye~~")).toBe("~bye~");
  });

  it("preserves dash bullets as Slack-native list markers", () => {
    expect(toSlackMrkdwn("- one\n- two")).toBe("- one\n- two");
  });

  it("rewrites asterisk bullets as dashes so they don't collide with bold", () => {
    expect(toSlackMrkdwn("* one\n* two")).toBe("- one\n- two");
  });

  it("collapses blank lines between consecutive list items", () => {
    expect(toSlackMrkdwn("- one\n\n- two\n\n- three")).toBe("- one\n- two\n- three");
    expect(toSlackMrkdwn("1. a\n\n2. b")).toBe("1. a\n2. b");
  });

  it("keeps blank lines around lists when adjacent to non-list paragraphs", () => {
    expect(toSlackMrkdwn("intro\n\n- one\n\n- two\n\noutro")).toBe(
      "intro\n\n- one\n- two\n\noutro",
    );
  });

  it("preserves fenced and inline code", () => {
    expect(toSlackMrkdwn("```ts\nx\n```")).toBe("```ts\nx\n```");
    expect(toSlackMrkdwn("see `code` here")).toBe("see `code` here");
  });
});

describe("copyAs email", () => {
  const write = vi.fn(async (_items: ClipboardItem[]): Promise<void> => undefined);

  beforeEach(() => {
    write.mockClear();
    toast.success.mockClear();
    toast.error.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    vi.stubGlobal(
      "ClipboardItem",
      class ClipboardItem {
        constructor(readonly data: Record<string, Blob>) {}
      },
    );
  });

  it("writes HTML and plain-text clipboard representations together", async () => {
    await copyAs("email", "# Heading", "<h1>Heading</h1>");

    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0]?.[0];
    const item = items?.[0] as unknown as { data: Record<string, Blob> };
    expect(Object.keys(item.data)).toEqual(["text/html", "text/plain"]);
    expect(item.data["text/html"]?.type).toBe("text/html");
    expect(item.data["text/plain"]?.type).toBe("text/plain");
    expect(toast.success).toHaveBeenCalledWith("Copied for email");
  });
});
