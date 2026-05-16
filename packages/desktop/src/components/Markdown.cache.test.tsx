import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@/test-utils";
import { Markdown, __markdownCacheTestHelpers as cache } from "./Markdown";

describe("Markdown — module-level tree cache", () => {
  beforeEach(() => {
    cache.clear();
  });

  it("populates the cache and reuses entries when cacheKey is provided", () => {
    const content = "# Cached heading\n\nWith body text.";
    expect(cache.size()).toBe(0);

    render(<Markdown content={content} cacheKey="block-1" />);
    // First render: cache miss → entry written. Key is content + sendToTerminal flag.
    expect(cache.size()).toBe(1);
    expect(cache.has(content, false)).toBe(true);

    cleanup();
    // Second render of the same content with a different `cacheKey` (same
    // content) must reuse the existing cache entry — size stays at 1.
    render(<Markdown content={content} cacheKey="block-2" />);
    expect(cache.size()).toBe(1);
  });

  it("bypasses the cache when cacheKey is undefined", () => {
    const content = "# Streaming heading\n\nMid-flight content.";
    expect(cache.size()).toBe(0);

    render(<Markdown content={content} />);
    expect(cache.size()).toBe(0);

    cleanup();
    render(<Markdown content={content} />);
    expect(cache.size()).toBe(0);
  });

  it("caches identical streaming-block content across re-renders", () => {
    // Regression for the ResizeObserver-loop fix: AgentBlock now passes
    // `block.id` as cacheKey even while a block is streaming. The first
    // render writes an entry; re-rendering with the same content (Virtuoso
    // remeasure, sibling re-render, panel resize) must reuse it instead of
    // re-running lowlight.highlight synchronously.
    const content = "# Streaming snapshot\n\n```\nhello world\n```";
    const { rerender } = render(<Markdown content={content} cacheKey="streaming-block" />);
    expect(cache.size()).toBe(1);

    rerender(<Markdown content={content} cacheKey="streaming-block" />);
    expect(cache.size()).toBe(1);
  });
});
