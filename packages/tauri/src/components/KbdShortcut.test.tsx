import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { KbdShortcut } from "./KbdShortcut";

describe("KbdShortcut", () => {
  it("renders text keys", () => {
    render(<KbdShortcut keys={["A"]} />);
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders multiple text keys", () => {
    render(<KbdShortcut keys={["ctrl", "S"]} />);
    expect(screen.getByText("⌃")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("renders cmd icon for cmd key", () => {
    const { container } = render(<KbdShortcut keys={["cmd"]} />);
    // cmd key renders an svg icon, no text
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders enter icon for enter key", () => {
    const { container } = render(<KbdShortcut keys={["enter"]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders mixed keys", () => {
    const { container } = render(<KbdShortcut keys={["cmd", "S"]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("renders as kbd element", () => {
    const { container } = render(<KbdShortcut keys={["X"]} />);
    expect(container.querySelector("kbd")).toBeInTheDocument();
  });
});
