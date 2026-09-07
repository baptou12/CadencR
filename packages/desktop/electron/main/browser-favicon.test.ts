import { describe, expect, it, vi } from "vitest";
import { faviconDataUrl, MAX_FAVICON_BYTES } from "./browser-favicon";

describe("faviconDataUrl", () => {
  it("fetches through the guest session and returns bounded image bytes", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png", "content-length": "4" },
        }),
    );

    await expect(faviconDataUrl({ fetch }, "https://example.com/favicon.png")).resolves.toBe(
      "data:image/png;base64,iVBORw==",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/favicon.png",
      expect.objectContaining({ cache: "no-store", credentials: "include", redirect: "follow" }),
    );
  });

  it("does not fetch non-HTTP URLs", async () => {
    const fetch = vi.fn();

    await expect(faviconDataUrl({ fetch }, "file:///tmp/icon.png")).resolves.toBeNull();
    await expect(faviconDataUrl({ fetch }, "data:image/png;base64,AA==")).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsafe image types and oversized declared bodies", async () => {
    const cancel = vi.fn();
    const svgFetch = vi.fn(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { "content-type": "image/svg+xml" },
        }),
    );
    const largeFetch = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: {
            "content-type": "image/png",
            "content-length": String(MAX_FAVICON_BYTES + 1),
          },
        }),
    );

    await expect(
      faviconDataUrl({ fetch: svgFetch }, "https://example.com/icon.svg"),
    ).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    await expect(
      faviconDataUrl({ fetch: largeFetch }, "https://example.com/icon.png"),
    ).resolves.toBeNull();
  });

  it("stops reading a streaming response at the byte limit", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array(MAX_FAVICON_BYTES + 1), {
          headers: { "content-type": "image/png" },
        }),
    );

    await expect(faviconDataUrl({ fetch }, "https://example.com/icon.png")).resolves.toBeNull();
  });
});
