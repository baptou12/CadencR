import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@/test-utils";
import { PromptEditor } from "../PromptEditor";

function createImageFile(name: string, type = "image/png"): File {
  return new File([new Blob(["x"], { type })], name, { type });
}

function clipboardItem(file: File): DataTransferItem {
  return { kind: "file", type: file.type, getAsFile: () => file } as unknown as DataTransferItem;
}

function dispatchPaste(target: Element, items: DataTransferItem[]): Event {
  // jsdom doesn't expose ClipboardEvent; emulate the shape the plugin reads.
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { items } });
  target.dispatchEvent(event);
  return event;
}

describe("ImagePastePlugin", () => {
  it("forwards pasted image files to onPasteImages and prevents default", async () => {
    const onPasteImages = vi.fn();
    render(<PromptEditor onPasteImages={onPasteImages} />);

    const file = createImageFile("screenshot.png");
    let event: Event | undefined;
    await act(async () => {
      event = dispatchPaste(screen.getByRole("textbox"), [clipboardItem(file)]);
    });

    expect(onPasteImages).toHaveBeenCalledTimes(1);
    expect(onPasteImages.mock.calls[0][0]).toEqual([file]);
    expect(event?.defaultPrevented).toBe(true);
  });

  it("ignores pastes that contain no image files", async () => {
    const onPasteImages = vi.fn();
    render(<PromptEditor onPasteImages={onPasteImages} />);

    const textItem = {
      kind: "string",
      type: "text/plain",
      getAsFile: () => null,
    } as unknown as DataTransferItem;

    await act(async () => {
      dispatchPaste(screen.getByRole("textbox"), [textItem]);
    });

    expect(onPasteImages).not.toHaveBeenCalled();
  });

  it("ignores pasted files with unsupported image types", async () => {
    const onPasteImages = vi.fn();
    render(<PromptEditor onPasteImages={onPasteImages} />);

    const svg = createImageFile("vector.svg", "image/svg+xml");
    await act(async () => {
      dispatchPaste(screen.getByRole("textbox"), [clipboardItem(svg)]);
    });

    expect(onPasteImages).not.toHaveBeenCalled();
  });
});
