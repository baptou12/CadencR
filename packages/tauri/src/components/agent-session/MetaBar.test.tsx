import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PROVIDER_IDS } from "@/lib/providers";
import { MetaBar, type MetaBarProps } from "./MetaBar";

/**
 * The mode chip is the central UI of the per-provider mode alignment work, so
 * lock its labels, colors, and visibility down with focused render tests.
 *
 * MetaBar has many other chips and a model picker — we provide the minimum
 * props needed to render and only assert on the mode chip.
 */
function renderChip(overrides: Partial<MetaBarProps> = {}) {
  const baseProps: MetaBarProps = {
    showAutoScrollChip: false,
    autoScrollEnabled: false,
    onToggleAutoScroll: vi.fn(),
    showWorktreeChip: false,
    showDiffBar: false,
    currentModelLabel: "claude-sonnet",
    models: [],
    onPermissionModeToggle: vi.fn(),
    permissionMode: "acceptEdits",
    currentProviderId: PROVIDER_IDS.CLAUDE_CODE,
    ...overrides,
  };
  return render(<MetaBar {...baseProps} />);
}

describe("MetaBar mode chip", () => {
  it("renders 'Auto-Accept Edits' with violet styling for Claude Code's primary mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CLAUDE_CODE, permissionMode: "acceptEdits" });
    const chip = screen.getByRole("button", { name: /Permission mode: Auto-Accept Edits/i });
    expect(chip).toBeInTheDocument();
    expect(chip.className).toMatch(/violet/);
  });

  it("renders 'Plan' with green styling when Claude is in plan mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CLAUDE_CODE, permissionMode: "plan" });
    const chip = screen.getByRole("button", { name: /Permission mode: Plan/i });
    expect(chip.className).toMatch(/green/);
  });

  it("renders 'Auto' with yellow styling for Claude's classifier-backed mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CLAUDE_CODE, permissionMode: "auto" });
    const chip = screen.getByRole("button", { name: /Permission mode: Auto\b/i });
    expect(chip.className).toMatch(/yellow/);
  });

  it("renders 'Build' (fuchsia) for OpenCode's primary mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.OPENCODE, permissionMode: "acceptEdits" });
    const chip = screen.getByRole("button", { name: /Permission mode: Build/i });
    expect(chip.className).toMatch(/fuchsia/);
  });

  it("renders 'Default' (blue) for Codex's primary mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CODEX_CLI, permissionMode: "default" });
    const chip = screen.getByRole("button", { name: /Permission mode: Default/i });
    expect(chip.className).toMatch(/blue/);
  });

  it("renders 'Full Access' (red) for Codex when the opt-in toggle is on", () => {
    renderChip({
      currentProviderId: PROVIDER_IDS.CODEX_CLI,
      permissionMode: "bypassPermissions",
      enabledOptInModes: ["bypassPermissions"],
    });
    const chip = screen.getByRole("button", { name: /Permission mode: Full Access/i });
    expect(chip.className).toMatch(/red/);
  });

  it("hides the chip entirely when no toggle handler is wired (kickoff scenarios)", () => {
    renderChip({ onPermissionModeToggle: undefined });
    expect(screen.queryByRole("button", { name: /Permission mode/i })).toBeNull();
  });
});
