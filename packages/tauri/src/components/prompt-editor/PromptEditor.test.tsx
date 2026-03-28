import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { PromptEditor, type PromptEditorHandle } from "./PromptEditor";
import { createRef } from "react";

describe("PromptEditor", () => {
  it("renders with placeholder text", () => {
    render(<PromptEditor placeholder="Type here..." />);
    expect(screen.getByText("Type here...")).toBeInTheDocument();
  });

  it("does not format markdown syntax as rich text", async () => {
    const onChange = vi.fn();
    const ref = createRef<PromptEditorHandle>();
    render(<PromptEditor ref={ref} onChange={onChange} />);

    await act(async () => {
      ref.current!.setText("**bold** and _italic_");
    });

    // The raw text should be preserved as-is, not converted to formatted text
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toContain("**bold**");
    expect(lastCall).toContain("_italic_");
  });

  it("returns raw text from getText()", async () => {
    const ref = createRef<PromptEditorHandle>();
    render(<PromptEditor ref={ref} />);

    await act(async () => {
      ref.current!.setText("# heading **bold**");
    });

    const text = ref.current!.getText();
    expect(text).toBe("# heading **bold**");
  });

  it("initializes with initialText", () => {
    const ref = createRef<PromptEditorHandle>();
    render(<PromptEditor ref={ref} initialText="hello world" />);

    expect(ref.current!.getText()).toBe("hello world");
  });

  it("clears editor content", async () => {
    const ref = createRef<PromptEditorHandle>();
    render(<PromptEditor ref={ref} initialText="some text" />);

    await act(async () => {
      ref.current!.clear();
    });

    expect(ref.current!.getText()).toBe("");
  });
});
