import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { SlashCommandPopover } from "./SlashCommandPopover";

const commands = [
  {
    name: "commit",
    description: "Commit changes",
    kind: "command" as const,
    argumentHint: undefined,
  },
  {
    name: "plan",
    description: "Create a plan",
    kind: "skill" as const,
    argumentHint: "[description]",
  },
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
      </SlashCommandPopover>,
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
      </SlashCommandPopover>,
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
      </SlashCommandPopover>,
    );
    expect(screen.getByText("/commit")).toBeInTheDocument();
    expect(screen.getByText("/plan")).toBeInTheDocument();
  });

  it("does not render command kind badges", () => {
    render(
      <SlashCommandPopover
        open={true}
        items={commands}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
      >
        <input />
      </SlashCommandPopover>,
    );
    expect(screen.queryByText("command")).not.toBeInTheDocument();
    expect(screen.queryByText("skill")).not.toBeInTheDocument();
  });

  it("uses selected-item contrast for selected command descriptions", () => {
    render(
      <SlashCommandPopover
        open={true}
        items={commands}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
      >
        <input />
      </SlashCommandPopover>,
    );

    expect(screen.getByText("Commit changes")).toHaveClass("text-accent-foreground/80");
    expect(screen.getByText("Create a plan")).toHaveClass("text-muted-foreground");
  });

  it("renders skill trigger prefix when provided", () => {
    render(
      <SlashCommandPopover
        open={true}
        items={[commands[1]]}
        selectedIndex={0}
        onSelect={vi.fn()}
        isLoading={false}
        triggerChar="$"
      >
        <input />
      </SlashCommandPopover>,
    );
    expect(screen.getByText("$plan")).toBeInTheDocument();
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
      </SlashCommandPopover>,
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
      </SlashCommandPopover>,
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
      </SlashCommandPopover>,
    );
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByText("/commit") });
    expect(onSelect).toHaveBeenCalledWith("commit");
  });
});
