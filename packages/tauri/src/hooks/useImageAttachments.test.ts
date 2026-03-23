import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useImageAttachments } from "./useImageAttachments";

// Helper to create a mock File that triggers FileReader.load
function createMockFile(name: string, type: string, size = 100): File {
  const blob = new Blob(["x".repeat(size)], { type });
  return new File([blob], name, { type });
}

describe("useImageAttachments", () => {
  beforeEach(() => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // Mock FileReader
    vi.stubGlobal(
      "FileReader",
      class {
        addEventListener(event: string, cb: (e: { target: { result: string } }) => void) {
          if (event === "load") {
            setTimeout(() => cb({ target: { result: "data:image/png;base64,abc123" } }), 0);
          }
        }
        readAsDataURL() {}
      },
    );

    // Mock crypto.randomUUID
    let counter = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => `mock-uuid-${++counter}` as `${string}-${string}-${string}-${string}-${string}`);
  });

  it("starts with empty attachments", () => {
    const { result } = renderHook(() => useImageAttachments());
    expect(result.current.attachments).toEqual([]);
    expect(result.current.isDragging).toBe(false);
  });

  it("adds a valid image file", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const file = createMockFile("test.png", "image/png");

    act(() => {
      result.current.addFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.attachments).toHaveLength(1);
    });

    expect(result.current.attachments[0].mimeType).toBe("image/png");
    expect(result.current.attachments[0].base64).toBe("abc123");
  });

  it("rejects unsupported file types", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const file = createMockFile("doc.pdf", "application/pdf");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    act(() => {
      result.current.addFiles([file]);
    });

    // Give FileReader time to process (it shouldn't)
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.attachments).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("removes an attachment by id", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const file = createMockFile("test.png", "image/png");

    act(() => {
      result.current.addFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.attachments).toHaveLength(1);
    });

    const id = result.current.attachments[0].id;
    act(() => {
      result.current.removeAttachment(id);
    });

    expect(result.current.attachments).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("clears all attachments", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const files = [
      createMockFile("a.png", "image/png"),
      createMockFile("b.jpg", "image/jpeg"),
    ];

    act(() => {
      result.current.addFiles(files);
    });

    await waitFor(() => {
      expect(result.current.attachments).toHaveLength(2);
    });

    act(() => {
      result.current.clearAttachments();
    });

    expect(result.current.attachments).toHaveLength(0);
  });

  it("sets isDragging on drag over", () => {
    const { result } = renderHook(() => useImageAttachments());
    const event = { preventDefault: vi.fn() } as unknown as React.DragEvent;

    act(() => {
      result.current.dragHandlers.onDragOver(event);
    });

    expect(result.current.isDragging).toBe(true);
  });

  it("clears isDragging on drag leave", () => {
    const { result } = renderHook(() => useImageAttachments());
    const event = { preventDefault: vi.fn() } as unknown as React.DragEvent;

    act(() => {
      result.current.dragHandlers.onDragOver(event);
    });
    act(() => {
      result.current.dragHandlers.onDragLeave(event);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it("adds files on drop", async () => {
    const { result } = renderHook(() => useImageAttachments());
    const file = createMockFile("dropped.png", "image/png");
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [file] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.dragHandlers.onDrop(event);
    });

    await waitFor(() => {
      expect(result.current.attachments).toHaveLength(1);
    });
    expect(result.current.isDragging).toBe(false);
  });
});
