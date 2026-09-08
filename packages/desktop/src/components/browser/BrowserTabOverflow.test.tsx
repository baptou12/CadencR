import { describe, expect, it, vi } from "vitest";

import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import { fireEvent, render, screen } from "@/test-utils";
import { BrowserTabOverflow } from "./BrowserTabOverflow";

function tab(id: string, title: string): BrowserTabMetadata {
  return {
    id,
    title,
    url: `https://${id}.example/`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: "default",
    isActive: id === "alpha",
    devToolsOpen: false,
    pinned: false,
    suspended: false,
    zoomPercent: 100,
    scopeId: 1,
  };
}

describe("BrowserTabOverflow", () => {
  it("notifies suppression when keyboard selection closes the searchable list", async () => {
    const onActivate = vi.fn();
    const onOpenChange = vi.fn();
    const { user } = render(
      <BrowserTabOverflow
        tabs={[tab("alpha", "Alpha"), tab("beta", "Beta")]}
        activeTabId="beta"
        busy={false}
        onActivate={onActivate}
        onClose={vi.fn()}
        onReopen={vi.fn()}
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Search all 2 browser tabs" }));
    const search = await screen.findByRole("combobox", { name: "Search browser tabs" });
    fireEvent.change(search, { target: { value: "Alpha" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onActivate).toHaveBeenCalledWith("alpha");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("combobox", { name: "Search browser tabs" })).toBeNull();
  });
});
