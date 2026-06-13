import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
      </DropdownMenu>,
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
      </DropdownMenu>,
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
      </DropdownMenu>,
    );
    await user.click(screen.getByText("Open"));
    await user.click(screen.getByText("Clickable"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("opens submenu items, portalled outside the clipping parent content", async () => {
    const { user } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Set default</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Layout A</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await user.click(screen.getByText("Open"));
    // ArrowDown focuses the first item (the sub-trigger), ArrowRight opens the submenu.
    await user.keyboard("{ArrowDown}{ArrowRight}");

    const subItem = await screen.findByText("Layout A");
    expect(subItem).toBeInTheDocument();

    // Regression guard: the sub-content must be portalled, not nested inside the
    // parent content (which clips with overflow), or it would be invisible.
    const parentContent = document.querySelector('[data-slot="dropdown-menu-content"]');
    const subContent = document.querySelector('[data-slot="dropdown-menu-sub-content"]');
    expect(parentContent).not.toBeNull();
    expect(subContent).not.toBeNull();
    expect(parentContent?.contains(subContent)).toBe(false);
  });
});
