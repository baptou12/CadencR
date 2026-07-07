import { fireEvent, render, screen } from "@/test-utils";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";
import type { SplitOrientation } from "@/hooks/useTerminalState";
import { TerminalPaneContextMenu } from "./TerminalPaneContextMenu";

interface PortalSiblingHarnessProps {
  onSplit: (paneId: string, orientation: SplitOrientation) => void;
  onClose: (paneId: string) => void;
  onCopy: (paneId: string) => void;
  onPaste: (paneId: string) => void;
}

function PortalSiblingHarness({
  onSplit,
  onClose,
  onCopy,
  onPaste,
}: PortalSiblingHarnessProps): ReactNode {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <TerminalPaneContextMenu
        paneId="pane-1"
        canClose
        onSplit={onSplit}
        onClose={onClose}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div ref={setSlot} />
      </TerminalPaneContextMenu>
      {slot ? createPortal(<span>Portal XTerm Surface</span>, slot) : null}
    </>
  );
}

describe("TerminalPaneContextMenu", () => {
  it("shows terminal pane actions with shortcut hints", async () => {
    const onSplit = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();

    render(
      <TerminalPaneContextMenu
        paneId="pane-1"
        canClose
        onSplit={onSplit}
        onClose={onClose}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div>Terminal Pane</div>
      </TerminalPaneContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Terminal Pane"));

    expect(
      await screen.findByRole("menuitem", { name: /Split horizontally/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Split vertically/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Close/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Paste/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy/i })).toBeInTheDocument();
    expect(screen.getAllByText(/D$/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/W$/)).toBeInTheDocument();
  });

  it("routes terminal pane menu actions to the selected pane", async () => {
    const onSplit = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();

    render(
      <TerminalPaneContextMenu
        paneId="pane-1"
        canClose
        onSplit={onSplit}
        onClose={onClose}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div>Terminal Pane</div>
      </TerminalPaneContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Terminal Pane"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Split horizontally/i }));
    expect(onSplit).toHaveBeenCalledWith("pane-1", "horizontal");

    fireEvent.contextMenu(screen.getByText("Terminal Pane"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Close/i }));
    expect(onClose).toHaveBeenCalledWith("pane-1");
  });

  it("keeps actions clickable through the pointer down that starts a real menu click", async () => {
    const onSplit = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();

    render(
      <TerminalPaneContextMenu
        paneId="pane-1"
        canClose
        onSplit={onSplit}
        onClose={onClose}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div>Terminal Pane</div>
      </TerminalPaneContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Terminal Pane"));
    const splitItem = await screen.findByRole("menuitem", { name: /Split horizontally/i });

    fireEvent.mouseDown(splitItem);
    fireEvent.click(splitItem);

    expect(onSplit).toHaveBeenCalledWith("pane-1", "horizontal");
  });

  it("opens from capture phase when the terminal child stops context-menu bubbling", async () => {
    const onSplit = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();

    render(
      <TerminalPaneContextMenu
        paneId="pane-1"
        canClose
        onSplit={onSplit}
        onClose={onClose}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div>
          <span onContextMenu={(event) => event.stopPropagation()}>XTerm Surface</span>
        </div>
      </TerminalPaneContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("XTerm Surface"));

    expect(
      await screen.findByRole("menuitem", { name: /Split horizontally/i }),
    ).toBeInTheDocument();
  });

  it("opens for xterm portal content rendered by a sibling component", async () => {
    const onSplit = vi.fn();
    const onClose = vi.fn();
    const onCopy = vi.fn();
    const onPaste = vi.fn();

    render(
      <PortalSiblingHarness
        onSplit={onSplit}
        onClose={onClose}
        onCopy={onCopy}
        onPaste={onPaste}
      />,
    );

    fireEvent.contextMenu(await screen.findByText("Portal XTerm Surface"));

    expect(
      await screen.findByRole("menuitem", { name: /Split horizontally/i }),
    ).toBeInTheDocument();
  });

  it("asks Electron to suppress the native terminal edit menu before opening", async () => {
    const suppressNextNativeContextMenu = vi.fn();
    setDesktopBridgeOverrideForTests({
      isElectron: true,
      suppressNextNativeContextMenu,
    });

    render(
      <TerminalPaneContextMenu
        paneId="pane-1"
        canClose
        onSplit={vi.fn()}
        onClose={vi.fn()}
        onCopy={vi.fn()}
        onPaste={vi.fn()}
      >
        <div>Terminal Pane</div>
      </TerminalPaneContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Terminal Pane"));

    expect(suppressNextNativeContextMenu).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("menuitem", { name: /Split horizontally/i }),
    ).toBeInTheDocument();

    clearDesktopBridgeOverrideForTests();
  });
});
