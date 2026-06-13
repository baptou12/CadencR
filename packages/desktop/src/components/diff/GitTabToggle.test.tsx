import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { GitTabToggle } from "./GitTabToggle";

describe("GitTabToggle", () => {
  it("renders both options with the target branch interpolated", () => {
    render(<GitTabToggle value="uncommitted" onChange={vi.fn()} targetBranch="main" />);
    expect(screen.getByRole("tab", { name: "Uncommitted" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "vs main" })).toBeInTheDocument();
  });

  it("falls back to 'vs target' when no branch is supplied", () => {
    render(<GitTabToggle value="uncommitted" onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "vs target" })).toBeInTheDocument();
  });

  it("marks the active tab via aria-selected", () => {
    render(<GitTabToggle value="vs-target" onChange={vi.fn()} targetBranch="develop" />);
    expect(screen.getByRole("tab", { name: "Uncommitted" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tab", { name: "vs develop" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("calls onChange with the matching value when a tab is clicked", () => {
    const onChange = vi.fn();
    render(<GitTabToggle value="uncommitted" onChange={onChange} targetBranch="main" />);
    fireEvent.click(screen.getByRole("tab", { name: "vs main" }));
    expect(onChange).toHaveBeenCalledWith("vs-target");
  });

  it("renders the Graph tab and reports its value on click", () => {
    const onChange = vi.fn();
    render(<GitTabToggle value="graph" onChange={onChange} targetBranch="main" />);
    const graphTab = screen.getByRole("tab", { name: "Graph" });
    expect(graphTab).toHaveAttribute("aria-selected", "true");
    fireEvent.click(graphTab);
    // Clicking the already-active tab still reports its value to the parent.
    expect(onChange).toHaveBeenCalledWith("graph");
  });

  it("disables both tabs when disabled is true", () => {
    render(<GitTabToggle value="uncommitted" onChange={vi.fn()} targetBranch="main" disabled />);
    expect(screen.getByRole("tab", { name: "Uncommitted" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "vs main" })).toBeDisabled();
  });
});
