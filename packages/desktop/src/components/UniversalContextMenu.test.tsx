import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UniversalContextMenu from "./UniversalContextMenu";

const copyAs = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const copyToClipboard = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@/lib/markdown-export", () => ({ copyAs }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboard }));

function select(element: Element): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("UniversalContextMenu", () => {
  beforeEach(() => {
    copyAs.mockClear();
    copyToClipboard.mockClear();
    window.getSelection()?.removeAllRanges();
  });

  it("restores all rich copy actions for a conversation selection fallback", async () => {
    render(
      <UniversalContextMenu>
        <div data-rich-copy="true">
          <h2>Rich heading</h2>
        </div>
      </UniversalContextMenu>,
    );
    const heading = screen.getByRole("heading", { name: "Rich heading" });
    select(heading);

    fireEvent.contextMenu(heading, { clientX: 20, clientY: 30 });

    expect(screen.getByRole("menu")).toHaveAttribute("data-slot", "context-menu-content");
    expect(screen.getByRole("menuitem", { name: /Copy as Markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Copy for Slack/i })).toBeInTheDocument();
    const email = screen.getByRole("menuitem", { name: /Copy for email/i });
    fireEvent.click(email);

    expect(copyAs).toHaveBeenCalledWith("email", "Rich heading", expect.stringContaining("<h2"));
  });

  it("keeps the global non-conversation fallback limited to plain Copy", () => {
    render(
      <UniversalContextMenu>
        <p>Outside conversation</p>
      </UniversalContextMenu>,
    );
    const paragraph = screen.getByText("Outside conversation");
    select(paragraph);

    fireEvent.contextMenu(paragraph);

    expect(screen.getByRole("menuitem", { name: /^Copy/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Markdown/i })).toBeNull();
  });
});
