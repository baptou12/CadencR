import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { SlashCommandPopover } from "./SlashCommandPopover";

const commands = [
  { name: "commit", description: "Commit changes", argumentHint: null },
  { name: "plan", description: "Create a plan", argumentHint: "[description]" },
];

describe("SlashCommandPopover", () => {
  it("renders children", () => {
    render(
      <SlashCommandPopover
        open={false}
        items={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
      >
        <input placeholder="Type command" />
      </SlashCommandPopover>
    );
    expect(screen.getByPlaceholderText("Type command")).toBeInTheDocument();
  });

  it("does not show popover when closed", () => {
    render(
      <SlashCommandPopover
        open={false}
        items={commands}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
      >
        <input />
      </SlashCommandPopover>
    );
    expect(screen.queryByText("/commit")).not.toBeInTheDocument();
  });

  it("shows commands when open", () => {
    render(
      <SlashCommandPopover
        open={true}
        items={commands}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
      >
        <input />
      </SlashCommandPopover>
    );
    expect(screen.getByText("/commit")).toBeInTheDocument();
    expect(screen.getByText("/plan")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <SlashCommandPopover
        open={true}
        items={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={true}
      >
        <input />
      </SlashCommandPopover>
    );
    expect(screen.getByText(/loading commands/i)).toBeInTheDocument();
  });

  it("shows empty message when no commands", () => {
    render(
      <SlashCommandPopover
        open={true}
        items={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
      >
        <input />
      </SlashCommandPopover>
    );
    expect(screen.getByText(/no matching commands/i)).toBeInTheDocument();
  });

  it("calls onSelect with command name on click", async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <SlashCommandPopover
        open={true}
        items={commands}
        selectedIndex={0}
        onSelect={onSelect}
        isLoading={false}
      >
        <input />
      </SlashCommandPopover>
    );
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByText("/commit") });
    expect(onSelect).toHaveBeenCalledWith("commit");
  });
});
