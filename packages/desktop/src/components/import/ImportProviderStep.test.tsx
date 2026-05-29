import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PROVIDER_IDS } from "@/lib/providers";
import { ImportProviderStep } from "./ImportProviderStep";

describe("ImportProviderStep", () => {
  it("emits selected Claude, Codex, and OpenCode provider ids", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImportProviderStep onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: /Claude/i }));
    await user.click(screen.getByRole("button", { name: /Codex/i }));
    await user.click(screen.getByRole("button", { name: /OpenCode/i }));

    expect(onSelect).toHaveBeenNthCalledWith(1, PROVIDER_IDS.CLAUDE_CODE);
    expect(onSelect).toHaveBeenNthCalledWith(2, PROVIDER_IDS.CODEX_CLI);
    expect(onSelect).toHaveBeenNthCalledWith(3, PROVIDER_IDS.OPENCODE);
  });
});
