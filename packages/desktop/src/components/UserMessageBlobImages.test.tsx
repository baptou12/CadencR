import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLOB_REF_SCHEME } from "@/lib/blob-ref";
import { parseUserMessageContent } from "@/types/agent-types";
import { UserMessageImages } from "./UserMessageImages";

const HASH = "a".repeat(64);

vi.mock("@/lib/blob-ref", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blob-ref")>();
  return {
    ...actual,
    fetchBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })),
  };
});

function withQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

/** A message whose payload the backend moved to the on-disk blob store. */
function blobBackedMessage(): string {
  return JSON.stringify([
    { type: "text", text: "look at this" },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: `${BLOB_REF_SCHEME}${HASH}` },
    },
  ]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("off-loaded user message images", () => {
  it("parses a blob reference as a hash rather than as base64 bytes", () => {
    const parsed = parseUserMessageContent(blobBackedMessage());

    expect(parsed.text).toBe("look at this");
    expect(parsed.images).toEqual([{ mediaType: "image/png", blobHash: HASH }]);
    // The reference must never be mistaken for a payload — that would render
    // "cadencr-blob://…" into an <img src> as a broken image.
    expect(parsed.images[0].base64).toBeUndefined();
  });

  it("fetches the payload and renders it as an object URL", async () => {
    const { images } = parseUserMessageContent(blobBackedMessage());

    render(withQueryClient(<UserMessageImages images={images} />));

    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^blob:/)),
    );
  });

  it("says so when the blob can no longer be fetched", async () => {
    // A 404 means the bytes are gone — the blob dir was cleared, or the message
    // is being read on a machine that doesn't hold it. Rendering the same
    // placeholder as "still loading" leaves the user waiting on nothing.
    const { fetchBlob } = await import("@/lib/blob-ref");
    vi.mocked(fetchBlob).mockRejectedValueOnce(new Error("404"));
    const { images } = parseUserMessageContent(blobBackedMessage());

    render(withQueryClient(<UserMessageImages images={images} />));

    expect(await screen.findByText(/no longer available in local storage/i)).toBeInTheDocument();
  });

  it("renders without a QueryClient when nothing was off-loaded", () => {
    // The common case must not require react-query: a plain inline payload
    // renders in isolation, with no provider in the tree.
    const inline = JSON.stringify([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ]);
    const { images } = parseUserMessageContent(inline);

    expect(() => render(<UserMessageImages images={images} />)).not.toThrow();
  });
});
