import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@/test-utils";
import { ShortcutTooltip } from "./ShortcutTooltip";

describe("ShortcutTooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("shows tooltip after hover delay", () => {
    render(
      <ShortcutTooltip label="My label" keys={["cmd", "S"]}>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText("Btn").parentElement!);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText("My label")).toBeInTheDocument();
  });

  it("hides tooltip on mouse leave", () => {
    render(
      <ShortcutTooltip label="My label" keys={["cmd", "S"]}>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText("My label")).toBeInTheDocument();

    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByText("My label")).not.toBeInTheDocument();
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

  it("positions tooltip above when above prop is set", () => {
    render(
      <ShortcutTooltip label="Above" keys={["cmd", "B"]} above>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => vi.advanceTimersByTime(400));

    const tooltip = screen.getByText("Above").closest("div.pointer-events-none") ?? screen.getByText("Above").parentElement!;
    expect(tooltip?.className).toContain("bottom-full");
    expect(tooltip?.className).not.toContain("top-full");
  });

  it("positions tooltip below by default", () => {
    render(
      <ShortcutTooltip label="Below" keys={["cmd", "B"]}>
        <button>Btn</button>
      </ShortcutTooltip>,
    );
    const wrapper = screen.getByText("Btn").parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => vi.advanceTimersByTime(400));

    const tooltip = screen.getByText("Below").closest("div.pointer-events-none") ?? screen.getByText("Below").parentElement!;
    expect(tooltip?.className).toContain("top-full");
    expect(tooltip?.className).not.toContain("bottom-full");
  });
});
