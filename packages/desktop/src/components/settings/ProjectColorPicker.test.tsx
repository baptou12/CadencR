import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { ProjectColorPicker } from "./ProjectColorPicker";
import { PROJECT_COLORS } from "@/lib/project-colors";

describe("ProjectColorPicker", () => {
  it("renders one swatch per project color", () => {
    render(<ProjectColorPicker value="" onChange={vi.fn()} />);
    const swatches = screen.getAllByRole("radio");
    expect(swatches).toHaveLength(PROJECT_COLORS.length);
  });

  it("marks the active swatch as checked and calls onChange when another is clicked", () => {
    const onChange = vi.fn();
    render(<ProjectColorPicker value="3b82f6" onChange={onChange} />);
    const active = screen.getByRole("radio", { name: "#3b82f6" });
    expect(active).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "#ef4444" }));
    expect(onChange).toHaveBeenCalledWith("ef4444");
  });

  it('clears the override when the user clicks "Reset"', () => {
    const onChange = vi.fn();
    render(<ProjectColorPicker value="3b82f6" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it('exposes a hex input behind "Custom hex" that sanitizes input and forwards it', () => {
    const onChange = vi.fn();
    render(<ProjectColorPicker value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom hex" }));

    const input = screen.getByPlaceholderText("3b82f6");
    // Anything non-hex (or beyond six chars) must be stripped before save.
    fireEvent.change(input, { target: { value: "##aaBB!!cc99zz" } });
    expect(onChange).toHaveBeenCalledWith("aabbcc"); // lowercased + 6 chars
  });
});
