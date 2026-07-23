import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureRenameForm } from "./FeatureRenamePopover";

vi.mock("@/api/generated", () => ({
  useUpdateFeatureTitle: vi.fn(() => ({
    isPending: false,
    mutate: vi.fn(),
  })),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("FeatureRenameForm", () => {
  it("focuses and selects the current title when opened", () => {
    const currentTitle = "Existing conversation title";
    render(<FeatureRenameForm featureId={1} currentTitle={currentTitle} onClose={vi.fn()} open />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveFocus();
    expect(input).toHaveValue(currentTitle);
    expect(input).toHaveProperty("selectionStart", 0);
    expect(input).toHaveProperty("selectionEnd", currentTitle.length);
  });
});
