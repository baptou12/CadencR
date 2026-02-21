import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
  CommandEmpty,
} from "./command";

describe("Command", () => {
  it("renders a command input", () => {
    render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
        </CommandList>
      </Command>
    );
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("renders items in the list", () => {
    render(
      <Command>
        <CommandInput placeholder="Type..." />
        <CommandList>
          <CommandItem value="item1">First Item</CommandItem>
          <CommandItem value="item2">Second Item</CommandItem>
        </CommandList>
      </Command>
    );
    expect(screen.getByText("First Item")).toBeInTheDocument();
    expect(screen.getByText("Second Item")).toBeInTheDocument();
  });

  it("filters items based on input", async () => {
    const { user } = render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandItem value="apple">Apple</CommandItem>
          <CommandItem value="banana">Banana</CommandItem>
        </CommandList>
      </Command>
    );
    const input = screen.getByPlaceholderText("Search...");
    await user.type(input, "apple");
    // Apple should still be visible
    expect(screen.getByText("Apple")).toBeInTheDocument();
    // Banana should be filtered out (not in DOM or not visible)
    const banana = screen.queryByText("Banana");
    if (banana) {
      expect(banana).not.toBeVisible();
    }
    // At minimum, Apple is still shown
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("shows empty message when no results", async () => {
    const { user } = render(
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>Nothing found</CommandEmpty>
          <CommandItem value="item">An Item</CommandItem>
        </CommandList>
      </Command>
    );
    await user.type(screen.getByPlaceholderText("Search..."), "zzz");
    expect(screen.getByText("Nothing found")).toBeInTheDocument();
  });
});
