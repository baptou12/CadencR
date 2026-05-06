import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@/test-utils";
import { useAgentLetterFocus } from "./useAgentLetterFocus";

function Harness({ enabled, onFocus }: { enabled: boolean; onFocus: () => void }): ReactElement {
  useAgentLetterFocus({ enabled, onFocus });
  return <div data-testid="target" tabIndex={0} />;
}

describe("useAgentLetterFocus", () => {
  const onFocus = vi.fn();

  beforeEach(() => {
    onFocus.mockClear();
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.querySelector("[data-test-overlay]")?.remove();
  });

  it("focuses on lowercase, uppercase, and accented letters", () => {
    render(<Harness enabled onFocus={onFocus} />);

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "A", shiftKey: true });
    fireEvent.keyDown(window, { key: "é" });

    expect(onFocus).toHaveBeenCalledTimes(3);
  });

  it("ignores non-letter keys and modifier shortcuts", () => {
    render(<Harness enabled onFocus={onFocus} />);

    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a", metaKey: true });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "a", altKey: true });

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    render(<Harness enabled={false} onFocus={onFocus} />);

    fireEvent.keyDown(window, { key: "a" });

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("uses the latest focus callback without remounting the listener", () => {
    const firstFocus = vi.fn();
    const secondFocus = vi.fn();
    const { rerender } = render(<Harness enabled onFocus={firstFocus} />);

    rerender(<Harness enabled onFocus={secondFocus} />);
    fireEvent.keyDown(window, { key: "a" });

    expect(firstFocus).not.toHaveBeenCalled();
    expect(secondFocus).toHaveBeenCalledOnce();
  });

  it("does not steal focus from editable elements", () => {
    render(
      <>
        <input aria-label="Name" />
        <Harness enabled onFocus={onFocus} />
      </>,
    );
    const input = screen.getByLabelText("Name");
    input.focus();

    fireEvent.keyDown(input, { key: "a" });

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("does not steal focus from another focus zone", () => {
    render(
      <>
        <div data-focus-zone="left-sidebar" tabIndex={0} data-testid="sidebar" />
        <Harness enabled onFocus={onFocus} />
      </>,
    );
    screen.getByTestId("sidebar").focus();

    fireEvent.keyDown(window, { key: "a" });

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("does not focus while text is selected", () => {
    render(<Harness enabled onFocus={onFocus} />);
    const selected = document.createElement("p");
    selected.textContent = "selected text";
    document.body.appendChild(selected);
    const range = document.createRange();
    range.selectNodeContents(selected);
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(window, { key: "a" });

    expect(onFocus).not.toHaveBeenCalled();
    selected.remove();
  });

  it("does not focus while focus is inside an overlay", () => {
    render(<Harness enabled onFocus={onFocus} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-test-overlay", "true");
    dialog.tabIndex = 0;
    document.body.appendChild(dialog);
    dialog.focus();

    fireEvent.keyDown(window, { key: "a" });

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("ignores inert overlay markup when focus is outside it", () => {
    render(<Harness enabled onFocus={onFocus} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-test-overlay", "true");
    document.body.appendChild(dialog);

    fireEvent.keyDown(window, { key: "a" });

    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
