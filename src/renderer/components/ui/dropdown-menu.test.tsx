import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

describe("DropdownMenu", () => {
  it("renders trigger button", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByText("Open Menu")).toBeInTheDocument();
  });

  it("shows items on trigger click", async () => {
    const { user } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Action A</DropdownMenuItem>
          <DropdownMenuItem>Action B</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.queryByText("Action A")).not.toBeInTheDocument();
    await user.click(screen.getByText("Open"));
    expect(screen.getByText("Action A")).toBeInTheDocument();
    expect(screen.getByText("Action B")).toBeInTheDocument();
  });

  it("calls onClick on item click", async () => {
    const onClick = vi.fn();
    const { user } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onClick}>Clickable</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    await user.click(screen.getByText("Open"));
    await user.click(screen.getByText("Clickable"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
