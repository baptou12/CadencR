import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/test-utils";
import { RuntimeModelPicker, type RuntimeModelSelectionResolver } from "./RuntimeModelPicker";

const toggleFavorite = vi.fn();
let favorites = new Set<string>();

vi.mock("@/hooks/useFavoriteModels", () => ({
  useFavoriteModels: () => ({ favorites, toggleFavorite, isLoading: false }),
}));

function Harness(props: {
  onSelect?: (providerId: string, modelId: string) => void;
  onAfterSelectClose?: () => void;
  models?: Array<{ id: string; label: string }>;
  selectedModelId?: string;
  resolveSelectedModelId?: RuntimeModelSelectionResolver;
}) {
  const {
    models = [{ id: "opus", label: "Opus" }],
    onSelect = vi.fn(),
    onAfterSelectClose = vi.fn(),
    selectedModelId = "opus",
    resolveSelectedModelId,
  } = props;
  const [open, setOpen] = useState(false);

  return (
    <RuntimeModelPicker
      open={open}
      onOpenChange={setOpen}
      providers={[
        {
          id: "claude_code",
          label: "Claude",
          disabled: false,
          models,
        },
      ]}
      selectedProviderId="claude_code"
      selectedModelId={selectedModelId}
      resolveSelectedModelId={resolveSelectedModelId}
      onSelect={onSelect}
      onAfterSelectClose={onAfterSelectClose}
      trigger={<button type="button">Open picker</button>}
    />
  );
}

describe("RuntimeModelPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    favorites = new Set<string>();
  });

  it("calls the post-close callback after selecting a model", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onAfterSelectClose = vi.fn();

    render(<Harness onSelect={onSelect} onAfterSelectClose={onAfterSelectClose} />);

    await user.click(screen.getByRole("button", { name: "Open picker" }));
    await user.click(screen.getByRole("option", { name: /Claude \/ Opus/i }));

    expect(onSelect).toHaveBeenCalledWith("claude_code", "opus");
    await waitFor(() => expect(onAfterSelectClose).toHaveBeenCalled());
  });

  it("focuses and scrolls to the selected model when opened", async () => {
    const user = userEvent.setup();
    const models = [
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `model-${index}`,
        label: `Model ${index}`,
      })),
      { id: "opus", label: "Opus" },
    ];

    render(<Harness models={models} />);

    await user.click(screen.getByRole("button", { name: "Open picker" }));

    const selectedOption = screen.getByRole("option", { name: /Claude \/ Opus/i });
    await waitFor(() => expect(selectedOption).toHaveAttribute("data-selected", "true"));
    await waitFor(() =>
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
      }),
    );
  });

  it("resets the results scroll position when the filter changes", async () => {
    const user = userEvent.setup();
    const models = Array.from({ length: 30 }, (_, index) => ({
      id: `model-${index}`,
      label: index === 29 ? "Opus Max" : `Model ${index}`,
    }));

    render(<Harness models={models} />);

    await user.click(screen.getByRole("button", { name: "Open picker" }));

    const list = document.querySelector('[data-slot="command-list"]');
    expect(list).toBeInstanceOf(HTMLElement);
    const commandList = list as HTMLElement;
    commandList.scrollTop = 240;

    await user.type(screen.getByPlaceholderText("Search providers or models..."), "Op");

    await waitFor(() => expect(commandList.scrollTop).toBe(0));
  });

  it("does not resolve provider-specific model aliases unless a resolver is provided", async () => {
    const user = userEvent.setup();

    render(
      <Harness
        selectedModelId="sonnet"
        models={[{ id: "us.anthropic.claude-sonnet-4-6", label: "Sonnet" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open picker" }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Claude \/ Sonnet/i })).toHaveAttribute(
        "data-selected",
        "false",
      ),
    );
  });

  it("stars a model without selecting it", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(<Harness onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "Open picker" }));
    await user.click(screen.getByRole("button", { name: "Star Claude / Opus" }));

    expect(toggleFavorite).toHaveBeenCalledWith("claude_code:opus");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("stars the highlighted model with the keyboard shortcut", async () => {
    const user = userEvent.setup();

    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open picker" }));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Claude \/ Opus/i })).toHaveAttribute(
        "data-selected",
        "true",
      ),
    );

    await user.keyboard("{Meta>}s{/Meta}");

    expect(toggleFavorite).toHaveBeenCalledWith("claude_code:opus");
  });

  it("lists starred models in their own group above the rest, filtered or not", async () => {
    const user = userEvent.setup();
    favorites = new Set(["claude_code:zeta"]);

    render(
      <Harness
        models={[
          { id: "alpha", label: "Alpha" },
          { id: "zeta", label: "Zeta" },
        ]}
        selectedModelId="alpha"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open picker" }));

    function groupHeadingsWithOptions(): Array<{ heading: string; options: string[] }> {
      return Array.from(document.querySelectorAll('[data-slot="command-group"]'))
        .filter((group) => group.querySelectorAll('[role="option"]').length > 0)
        .map((group) => ({
          heading: group.querySelector("[cmdk-group-heading]")?.textContent ?? "",
          options: within(group as HTMLElement)
            .getAllByRole("option")
            .map((option) => option.getAttribute("data-value") ?? ""),
        }));
    }

    expect(groupHeadingsWithOptions()).toEqual([
      { heading: "Starred", options: ["claude_code:zeta"] },
      { heading: "All models", options: ["claude_code:alpha"] },
    ]);

    // The starred group still leads once a filter matches both models.
    await user.type(screen.getByPlaceholderText("Search providers or models..."), "a");

    await waitFor(() => expect(groupHeadingsWithOptions()[0]?.heading).toBe("Starred"));
    expect(groupHeadingsWithOptions()).toEqual([
      { heading: "Starred", options: ["claude_code:zeta"] },
      { heading: "All models", options: ["claude_code:alpha"] },
    ]);
  });

  it("uses an injected resolver to highlight provider-specific aliases", async () => {
    const user = userEvent.setup();
    const resolveSelectedModelId: RuntimeModelSelectionResolver = () =>
      "us.anthropic.claude-sonnet-4-6";

    render(
      <Harness
        selectedModelId="sonnet"
        resolveSelectedModelId={resolveSelectedModelId}
        models={[{ id: "us.anthropic.claude-sonnet-4-6", label: "Sonnet" }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open picker" }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Claude \/ Sonnet/i })).toHaveAttribute(
        "data-selected",
        "true",
      ),
    );
  });
});
