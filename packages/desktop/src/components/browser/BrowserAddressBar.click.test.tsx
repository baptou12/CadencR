import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { BrowserAddressBar, type BrowserAddressBarProps } from "./BrowserAddressBar";

interface SetupResult {
  onNavigate: ReturnType<typeof vi.fn>;
  onUrlChange: ReturnType<typeof vi.fn>;
}

function setup(overrides: Partial<BrowserAddressBarProps> = {}): SetupResult {
  const onNavigate = vi.fn();
  const onUrlChange = vi.fn();
  const props: BrowserAddressBarProps = {
    urlInput: "loc",
    pending: false,
    activeTab: null,
    knownOrigins: ["http://localhost:5173", "https://example.com"],
    inputRef: createRef<HTMLInputElement>(),
    onUrlChange,
    onUrlEditingChange: vi.fn(),
    onNavigate,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onReload: vi.fn(),
    onStop: vi.fn(),
    onDevTools: vi.fn(),
    onAddComment: vi.fn(),
    ...overrides,
  };
  render(<BrowserAddressBar {...props} />);
  return { onNavigate, onUrlChange };
}

describe("BrowserAddressBar suggestion click", () => {
  it("navigates to a suggestion on click", async () => {
    const user = userEvent.setup();
    const { onNavigate } = setup();
    await user.click(screen.getByLabelText("Browser URL"));
    const option = await screen.findByText("http://localhost:5173");
    await user.click(option);
    expect(onNavigate).toHaveBeenCalledWith("http://localhost:5173");
  });

  it("selects a suggestion on pointer down before blur can close the list", async () => {
    const user = userEvent.setup();
    const { onNavigate } = setup();
    const input = screen.getByLabelText("Browser URL");
    await user.click(input);
    const option = await screen.findByText("http://localhost:5173");

    fireEvent.pointerDown(option);
    fireEvent.blur(input);

    expect(onNavigate).toHaveBeenCalledWith("http://localhost:5173");
  });

  it("renders suggestions as a compact overlay and reports native-view overlap state", async () => {
    const user = userEvent.setup();
    const onSuggestionOverlayOpenChange = vi.fn();
    setup({ onSuggestionOverlayOpenChange });

    await user.click(screen.getByLabelText("Browser URL"));

    expect(await screen.findByRole("listbox")).toHaveClass("absolute");
    expect(onSuggestionOverlayOpenChange).toHaveBeenLastCalledWith(true);
  });
});
