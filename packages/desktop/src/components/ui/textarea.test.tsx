import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders a textarea element", () => {
    render(<Textarea />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with placeholder", () => {
    render(<Textarea placeholder="Write here..." />);
    expect(screen.getByPlaceholderText("Write here...")).toBeInTheDocument();
  });

  it("renders with initial value", () => {
    render(<Textarea defaultValue="initial text" />);
    expect(screen.getByRole("textbox")).toHaveValue("initial text");
  });

  it("is disabled when disabled prop is set", () => {
    render(<Textarea disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("calls onChange when typing", async () => {
    const onChange = vi.fn();
    const { user } = render(<Textarea onChange={onChange} />);
    await user.type(screen.getByRole("textbox"), "hello");
    expect(onChange).toHaveBeenCalled();
  });

  it("applies custom className", () => {
    render(<Textarea className="my-textarea" />);
    expect(screen.getByRole("textbox")).toHaveClass("my-textarea");
  });

  it("renders with rows attribute", () => {
    render(<Textarea rows={5} />);
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "5");
  });
});
