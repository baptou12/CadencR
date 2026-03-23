import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { Input } from "./input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with placeholder", () => {
    render(<Input placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText("Enter text...")).toBeInTheDocument();
  });

  it("renders with initial value", () => {
    render(<Input defaultValue="hello" />);
    expect(screen.getByRole("textbox")).toHaveValue("hello");
  });

  it("is disabled when disabled prop is set", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("calls onChange when typing", async () => {
    const onChange = vi.fn();
    const { user } = render(<Input onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "abc");
    expect(onChange).toHaveBeenCalled();
  });

  it("updates controlled value", async () => {
    let value = "";
    const { rerender } = render(<Input value={value} onChange={(e) => { value = e.target.value; }} />);
    rerender(<Input value="updated" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox")).toHaveValue("updated");
  });

  it("applies custom className", () => {
    render(<Input className="my-input" />);
    expect(screen.getByRole("textbox")).toHaveClass("my-input");
  });

  it("renders with type=email", () => {
    render(<Input type="email" />);
    expect(screen.getByRole("textbox")).toHaveAttribute("type", "email");
  });
});
