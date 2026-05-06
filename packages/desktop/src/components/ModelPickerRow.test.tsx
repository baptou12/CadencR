import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ModelPickerRow, INHERIT_VALUE } from "./ModelPickerRow";

const MODELS = [
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
];

describe("ModelPickerRow", () => {
  it("renders label and current model name", () => {
    render(
      <ModelPickerRow
        label="Plan"
        models={MODELS}
        currentValue="opus"
        effectiveModel="opus"
        showInherit={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Opus")).toBeInTheDocument();
  });

  it("shows inherit display when currentValue is INHERIT_VALUE", () => {
    render(
      <ModelPickerRow
        label="Plan"
        models={MODELS}
        currentValue={INHERIT_VALUE}
        effectiveModel="sonnet"
        showInherit
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Inherit (Sonnet)")).toBeInTheDocument();
  });

  it("calls onSelect when a model is chosen", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ModelPickerRow
        label="Plan"
        models={MODELS}
        currentValue="opus"
        effectiveModel="opus"
        showInherit={false}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Sonnet"));
    expect(onSelect).toHaveBeenCalledWith("sonnet");
  });

  it("shows inherit option only when showInherit is true", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ModelPickerRow
        label="Plan"
        models={MODELS}
        currentValue="opus"
        effectiveModel="opus"
        showInherit={false}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("combobox"));
    expect(screen.queryByText(/^Inherit/)).not.toBeInTheDocument();

    rerender(
      <ModelPickerRow
        label="Plan"
        models={MODELS}
        currentValue="opus"
        effectiveModel="sonnet"
        showInherit
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Inherit (Sonnet)")).toBeInTheDocument();
  });

  it("falls back to model id when label not found", () => {
    render(
      <ModelPickerRow
        label="Plan"
        models={MODELS}
        currentValue="unknown-model"
        effectiveModel="opus"
        showInherit={false}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("unknown-model")).toBeInTheDocument();
  });
});
