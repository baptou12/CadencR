import { describe, expect, it } from "vitest";
import { render, screen, within } from "@/test-utils";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";

describe("KeyboardShortcutsModal", () => {
  it("documents sidebar command-number and plan approval shortcuts", () => {
    render(<KeyboardShortcutsModal open onOpenChange={() => {}} />);

    expect(screen.getByText("Activate visible sidebar row")).toBeInTheDocument();
    expect(screen.getByText("Approve plan")).toBeInTheDocument();
    expect(screen.getByText("Request plan changes")).toBeInTheDocument();
    expect(screen.getByText("Reject plan")).toBeInTheDocument();

    const globalGroup = screen.getByText("Global").closest("div");
    expect(globalGroup).not.toBeNull();
    expect(within(globalGroup as HTMLElement).queryByText("New feature")).not.toBeInTheDocument();
  });
});
