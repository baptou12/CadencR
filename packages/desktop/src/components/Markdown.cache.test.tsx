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
});
