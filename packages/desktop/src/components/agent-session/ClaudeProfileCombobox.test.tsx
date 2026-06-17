import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { ClaudeProfileCombobox } from "./ClaudeProfileCombobox";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

describe("ClaudeProfileCombobox", () => {
  it("renders default plus custom profiles and selects a profile", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ClaudeProfileCombobox
        value="default"
        profiles={[{ name: "bedrock", env: {} }]}
        isLoading={false}
        isError={false}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: /Claude profile/i }));
    await user.type(screen.getByPlaceholderText("Search profiles…"), "bed");
    await user.click(await screen.findByRole("option", { name: "bedrock" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("bedrock"));
  });

  it("opens and selects profiles in the compact first-prompt variant", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ClaudeProfileCombobox
        value="default"
        profiles={[{ name: "bedrock", env: {} }]}
        isLoading={false}
        isError={false}
        onChange={onChange}
        variant="compact"
        label="Profile"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: /Claude profile/i }));
    const content = document.querySelector("[data-slot='popover-content']");
    expect(content).toHaveAttribute("data-side", "top");

    await user.click(await screen.findByRole("option", { name: "bedrock" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("bedrock"));
  });

  it("shows a visible loading state", () => {
    render(
      <ClaudeProfileCombobox
        value="default"
        profiles={[]}
        isLoading={true}
        isError={false}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Loading profiles/i)).toBeInTheDocument();
  });

  it("shows a visible error state", () => {
    render(
      <ClaudeProfileCombobox
        value="default"
        profiles={[]}
        isLoading={false}
        isError={true}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Failed to load profiles/i)).toBeInTheDocument();
  });
});
