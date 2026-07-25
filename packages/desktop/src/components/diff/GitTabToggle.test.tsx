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

  it("renders the Commits tab while reporting the persisted graph value", () => {
    const onChange = vi.fn();
    render(<GitTabToggle value="graph" onChange={onChange} targetBranch="main" />);
    const graphTab = screen.getByRole("tab", { name: "Commits" });
    expect(graphTab).toHaveAttribute("aria-selected", "true");
    fireEvent.click(graphTab);
    // Clicking the already-active tab still reports its value to the parent.
    expect(onChange).toHaveBeenCalledWith("graph");
  });

  it("renders the Branches tab and reports its value on click", () => {
    const onChange = vi.fn();
    render(<GitTabToggle value="branches" onChange={onChange} targetBranch="main" />);
    const branchesTab = screen.getByRole("tab", { name: "Branches" });
    expect(branchesTab).toHaveAttribute("aria-selected", "true");
    fireEvent.click(branchesTab);
    expect(onChange).toHaveBeenCalledWith("branches");
  });

  it("renders the backend-provided proposal label and reports the PR view", () => {
    const onChange = vi.fn();
    render(<GitTabToggle value="uncommitted" onChange={onChange} prLabel="MR" prAttention />);
    const prTab = screen.getByRole("tab", { name: "MR" });
    fireEvent.click(prTab);
    expect(onChange).toHaveBeenCalledWith("pr");
  });

  it("reveals the tab's keyboard shortcut on hover", () => {
    render(<GitTabToggle value="uncommitted" onChange={vi.fn()} prLabel="Pull request" />);

    fireEvent.mouseEnter(screen.getByRole("tab", { name: "Pull request" }).parentElement!);

    const tip = document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')!;
    expect(tip).toHaveTextContent("Pull request status, checks, and comments");
    // ⌘P — the binding registered for `git-show-pull-request`.
    expect(tip).toHaveTextContent("P");
  });

  it("disables both tabs when disabled is true", () => {
    render(<GitTabToggle value="uncommitted" onChange={vi.fn()} targetBranch="main" disabled />);
    expect(screen.getByRole("tab", { name: "Uncommitted" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "vs main" })).toBeDisabled();
  });
});
