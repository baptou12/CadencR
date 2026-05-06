import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

describe("Popover", () => {
  it("renders trigger", () => {
    render(
      <Popover>
        <PopoverTrigger>Show</PopoverTrigger>
        <PopoverContent>Popover content</PopoverContent>
      </Popover>,
    );
    expect(screen.getByText("Show")).toBeInTheDocument();
  });

  it("shows content on trigger click", async () => {
    const { user } = render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Pop content</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText("Pop content")).not.toBeInTheDocument();
    await user.click(screen.getByText("Open"));
    expect(screen.getByText("Pop content")).toBeInTheDocument();
  });

  it("hides content when trigger clicked again", async () => {
    const { user } = render(
      <Popover>
        <PopoverTrigger>Toggle</PopoverTrigger>
        <PopoverContent>Content</PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByText("Toggle"));
    expect(screen.getByText("Content")).toBeInTheDocument();
    await user.click(screen.getByText("Toggle"));
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
  });
});
