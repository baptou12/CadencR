import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { ShortcutTooltip } from "./ShortcutTooltip";

describe("ShortcutTooltip", () => {
  it("renders children", () => {
    render(
      <ShortcutTooltip label="Test" keys={["cmd", "K"]}>
        <button>Click me</button>
      </ShortcutTooltip>,
    );
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("does not show tooltip initially", () => {
    render(
      <ShortcutTooltip label="Test" keys={["cmd", "K"]}>
        <button>Click me</button>
      </ShortcutTooltip>,
    );
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
  });

  it("shows tooltip on hover and hides on leave", () => {
    render(
      <ShortcutTooltip label="My label" keys={["cmd", "S"]}>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByText("My label")).toBeInTheDocument();

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText("My label")).not.toBeInTheDocument();
  });

  it("renders without a keys row when keys is empty or omitted", () => {
    render(
      <ShortcutTooltip label="No keys">
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    fireEvent.mouseEnter(wrapper);
    const bubble = screen.getByText("No keys").parentElement!;
    expect(bubble.querySelector("kbd")).toBeNull();
  });

  it("applies className to wrapper", () => {
    render(
      <ShortcutTooltip label="Test" className="flex-1">
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    expect(wrapper.className).toContain("flex-1");
  });

  it("positions tooltip above the trigger when above prop is set", () => {
    render(
      <ShortcutTooltip label="Above" keys={["cmd", "B"]} above>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Btn").parentElement!);

    const bubble = screen.getByText("Above").parentElement!;
    // The new portal model uses inline `position: fixed` and a translateY
    // of -100% to lift the bubble above the trigger.
    expect(bubble.style.position).toBe("fixed");
    expect(bubble.style.transform).toContain("-100%");
  });

  it("positions tooltip below the trigger by default", () => {
    render(
      <ShortcutTooltip label="Below" keys={["cmd", "B"]}>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Btn").parentElement!);

    const bubble = screen.getByText("Below").parentElement!;
    expect(bubble.style.position).toBe("fixed");
    // Below mode keeps the Y translate at 0; alignRight/Left only changes X.
    expect(bubble.style.transform).toContain(", 0");
  });

  it("portals the bubble outside the wrapper so ancestor overflow can't clip it", () => {
    render(
      <ShortcutTooltip label="Portaled">
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    fireEvent.mouseEnter(wrapper);
    const bubble = screen.getByText("Portaled").parentElement!;
    // The bubble lives directly under `document.body`, not inside the wrapper.
    expect(wrapper.contains(bubble)).toBe(false);
    expect(bubble.parentElement).toBe(document.body);
  });
});
