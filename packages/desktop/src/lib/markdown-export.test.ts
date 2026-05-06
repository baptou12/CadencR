import { describe, it, expect } from "vitest";
import { toPlainText, toSlackMrkdwn } from "./markdown-export";

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

  it("converts unordered bullets to •", () => {
    expect(toSlackMrkdwn("- one\n- two")).toBe("•  one\n•  two");
  });

  it("preserves fenced and inline code", () => {
    expect(toSlackMrkdwn("```ts\nx\n```")).toBe("```ts\nx\n```");
    expect(toSlackMrkdwn("see `code` here")).toBe("see `code` here");
  });
});
