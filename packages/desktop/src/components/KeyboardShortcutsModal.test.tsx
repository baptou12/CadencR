import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";

describe("KeyboardShortcutsModal", () => {
  it("renders real shortcuts from the registry — sidebar, plan approval, and git", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);

    expect(screen.getByText("Open focused item")).toBeInTheDocument();
    expect(screen.getByText("Approve plan")).toBeInTheDocument();
    expect(screen.getByText("Request plan changes (feedback)")).toBeInTheDocument();
    expect(screen.getByText("Reject plan")).toBeInTheDocument();
    expect(screen.getByText("Git actions popover")).toBeInTheDocument();
  });

  it("does not render shortcuts that were removed from the codebase", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);
    // The old, drifted modal listed several shortcuts that aren't real bindings.
    // The registry should only carry actual `useHotkeys` registrations.
    expect(screen.queryByText("Mark session agent done")).not.toBeInTheDocument();
    expect(screen.queryByText("Start / continue build")).not.toBeInTheDocument();
    expect(screen.queryByText("Agent diff (current agent)")).not.toBeInTheDocument();
  });

  it("filters by description and by combo text via the search box", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);
    const search = screen.getByLabelText("Search shortcuts");

    fireEvent.change(search, { target: { value: "zoom" } });
    expect(screen.getByText("Zoom in")).toBeInTheDocument();
    expect(screen.queryByText("Git actions popover")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "git" } });
    expect(screen.getByText("Git actions popover")).toBeInTheDocument();
    expect(screen.queryByText("Zoom in")).not.toBeInTheDocument();
  });
});
