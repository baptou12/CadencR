import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";

describe("ContextMenu", () => {
  it("renders trigger", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Item</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.getByText("Right-click me")).toBeInTheDocument();
  });

  it("opens on contextmenu event and shows items", async () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Trigger</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Action A</ContextMenuItem>
          <ContextMenuItem>Action B</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    expect(screen.queryByText("Action A")).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByText("Trigger"));
    expect(await screen.findByText("Action A")).toBeInTheDocument();
    expect(screen.getByText("Action B")).toBeInTheDocument();
  });

  it("invokes onSelect when an item is chosen", async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <ContextMenu>
        <ContextMenuTrigger>Trigger</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Pick me</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText("Trigger"));
    await user.click(await screen.findByText("Pick me"));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
