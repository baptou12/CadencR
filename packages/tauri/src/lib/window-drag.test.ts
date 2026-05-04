import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MouseEvent } from "react";

const { mockStartDragging, mockToggleMaximize, mockToastError } = vi.hoisted(() => ({
  mockStartDragging: vi.fn(() => Promise.resolve()),
  mockToggleMaximize: vi.fn(() => Promise.resolve()),
  mockToastError: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: mockStartDragging,
    toggleMaximize: mockToggleMaximize,
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mockToastError },
}));

import { startDragging, toggleMaximize } from "./window-drag";

function makeEvent(overrides: Partial<MouseEvent> = {}): MouseEvent {
  const div = document.createElement("div");
  return {
    button: 0,
    target: div,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as MouseEvent;
}

describe("window-drag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startDragging", () => {
    it("calls startDragging on left-click", () => {
      const e = makeEvent();
      startDragging(e);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(mockStartDragging).toHaveBeenCalled();
    });

    it("ignores non-primary button", () => {
      const e = makeEvent({ button: 2 });
      startDragging(e);
      expect(e.preventDefault).not.toHaveBeenCalled();
      expect(mockStartDragging).not.toHaveBeenCalled();
    });

    it("ignores clicks on interactive elements", () => {
      const button = document.createElement("button");
      document.body.appendChild(button);
      const e = makeEvent({ target: button as unknown as EventTarget });
      startDragging(e);
      expect(mockStartDragging).not.toHaveBeenCalled();
      document.body.removeChild(button);
    });

    it("ignores clicks on children of interactive elements", () => {
      const anchor = document.createElement("a");
      const span = document.createElement("span");
      anchor.appendChild(span);
      document.body.appendChild(anchor);
      const e = makeEvent({ target: span as unknown as EventTarget });
      startDragging(e);
      expect(mockStartDragging).not.toHaveBeenCalled();
      document.body.removeChild(anchor);
    });

    it("ignores clicks inside a Radix dialog (synthetic-event bubbles up)", () => {
      // Repro for "selecting text in CommitDialog drags the window": Radix
      // mounts dialog content in a portal but React still bubbles the
      // synthetic event up through the React owner tree, which is itself
      // wrapped in a draggable region (FeatureTopBar).
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      const text = document.createElement("p");
      dialog.appendChild(text);
      document.body.appendChild(dialog);
      const e = makeEvent({ target: text as unknown as EventTarget });
      startDragging(e);
      expect(mockStartDragging).not.toHaveBeenCalled();
      document.body.removeChild(dialog);
    });

    it.each([["menu"], ["listbox"], ["alertdialog"], ["tooltip"]])(
      "ignores clicks inside role=%s",
      (role) => {
        const surface = document.createElement("div");
        surface.setAttribute("role", role);
        document.body.appendChild(surface);
        const e = makeEvent({ target: surface as unknown as EventTarget });
        startDragging(e);
        expect(mockStartDragging).not.toHaveBeenCalled();
        document.body.removeChild(surface);
      },
    );

    it("ignores shift-click (text-selection extension)", () => {
      const e = makeEvent({ shiftKey: true });
      startDragging(e);
      expect(mockStartDragging).not.toHaveBeenCalled();
    });

    it("ignores clicks while a text selection is active", () => {
      const p = document.createElement("p");
      p.textContent = "selectable text";
      document.body.appendChild(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);

      const e = makeEvent();
      startDragging(e);
      expect(mockStartDragging).not.toHaveBeenCalled();

      sel?.removeAllRanges();
      document.body.removeChild(p);
    });
  });

  describe("toggleMaximize", () => {
    it("calls toggleMaximize on left-click", () => {
      const e = makeEvent();
      toggleMaximize(e);
      expect(e.preventDefault).toHaveBeenCalled();
      expect(mockToggleMaximize).toHaveBeenCalled();
    });

    it("ignores non-primary button", () => {
      const e = makeEvent({ button: 1 });
      toggleMaximize(e);
      expect(mockToggleMaximize).not.toHaveBeenCalled();
    });

    it("ignores clicks on role=button elements", () => {
      const div = document.createElement("div");
      div.setAttribute("role", "button");
      document.body.appendChild(div);
      const e = makeEvent({ target: div as unknown as EventTarget });
      toggleMaximize(e);
      expect(mockToggleMaximize).not.toHaveBeenCalled();
      document.body.removeChild(div);
    });
  });

  describe("error handling", () => {
    it("shows toast on startDragging failure", async () => {
      mockStartDragging.mockRejectedValueOnce(new Error("fail"));
      startDragging(makeEvent());
      await vi.waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Failed to drag window");
      });
    });

    it("shows toast on toggleMaximize failure", async () => {
      mockToggleMaximize.mockRejectedValueOnce(new Error("fail"));
      toggleMaximize(makeEvent());
      await vi.waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Failed to toggle maximize");
      });
    });
  });
});
