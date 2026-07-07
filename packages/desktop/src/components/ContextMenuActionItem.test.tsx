import { render, screen } from "@/test-utils";
import { CopyIcon } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ContextMenu, ContextMenuContent } from "@/components/ui/context-menu";
import { ContextMenuActionItem } from "./ContextMenuActionItem";

describe("ContextMenuActionItem", () => {
  it("renders a shared icon, label, and explicit shortcut hint", () => {
    render(
      <ContextMenu open>
        <ContextMenuContent>
          <ContextMenuActionItem icon={CopyIcon} shortcutKeys={["mod", "shift", "c"]}>
            Copy Path
          </ContextMenuActionItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    expect(screen.getByRole("menuitem", { name: /Copy Path/i })).toBeInTheDocument();
    expect(screen.getByText(/C$/)).toBeInTheDocument();
  });

  it("can render a shortcut hint from the shortcut registry", () => {
    render(
      <ContextMenu open>
        <ContextMenuContent>
          <ContextMenuActionItem icon={CopyIcon} shortcutId="terminal-close">
            Close
          </ContextMenuActionItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    expect(screen.getByRole("menuitem", { name: /Close/i })).toBeInTheDocument();
    expect(screen.getByText(/W$/)).toBeInTheDocument();
  });

  it("forwards menu selection handlers", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ContextMenu open>
        <ContextMenuContent>
          <ContextMenuActionItem icon={CopyIcon} onSelect={onSelect}>
            Copy
          </ContextMenuActionItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    await user.click(screen.getByRole("menuitem", { name: /Copy/i }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
