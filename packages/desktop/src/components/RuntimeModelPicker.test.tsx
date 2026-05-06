import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { RuntimeModelPicker } from "./RuntimeModelPicker";

function Harness(props: {
  onSelect?: (providerId: string, modelId: string) => void;
  onAfterSelectClose?: () => void;
}) {
  const { onSelect = vi.fn(), onAfterSelectClose = vi.fn() } = props;
  const [open, setOpen] = useState(false);

  return (
    <RuntimeModelPicker
      open={open}
      onOpenChange={setOpen}
      providers={[
        {
          id: "claude_code",
          label: "Claude Code",
          disabled: false,
          models: [{ id: "opus", label: "Opus" }],
        },
      ]}
      selectedProviderId="claude_code"
      selectedModelId="opus"
      onSelect={onSelect}
      onAfterSelectClose={onAfterSelectClose}
      trigger={<button type="button">Open picker</button>}
    />
  );
}

describe("RuntimeModelPicker", () => {
  it("calls the post-close callback after selecting a model", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onAfterSelectClose = vi.fn();

    render(<Harness onSelect={onSelect} onAfterSelectClose={onAfterSelectClose} />);

    await user.click(screen.getByRole("button", { name: "Open picker" }));
    await user.click(screen.getByRole("option", { name: /Claude Code \/ Opus/i }));

    expect(onSelect).toHaveBeenCalledWith("claude_code", "opus");
    await waitFor(() => expect(onAfterSelectClose).toHaveBeenCalled());
  });
});
