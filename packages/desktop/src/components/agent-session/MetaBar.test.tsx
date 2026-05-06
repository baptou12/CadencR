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
  // Chip color tokens route through the active theme (see
  // lib/provider-modes.ts). Identities that fall outside the canonical
  // Dracula palette (violet / fuchsia / blue) live under `--chip-*`; the
  // ones that match Dracula directly stay on `--acc-*`. These assertions
  // check the var name rather than a Tailwind named color.
  it("renders 'Auto-Accept Edits' with violet styling for Claude Code's primary mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CLAUDE_CODE, permissionMode: "acceptEdits" });
    const chip = screen.getByRole("button", { name: /Permission mode: Auto-Accept Edits/i });
    expect(chip).toBeInTheDocument();
    expect(chip.className).toMatch(/--chip-violet/);
  });

  it("renders 'Plan' with green styling when Claude is in plan mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CLAUDE_CODE, permissionMode: "plan" });
    const chip = screen.getByRole("button", { name: /Permission mode: Plan/i });
    expect(chip.className).toMatch(/--acc-green/);
  });

  it("renders 'Auto' with yellow styling for Claude's classifier-backed mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CLAUDE_CODE, permissionMode: "auto" });
    const chip = screen.getByRole("button", { name: /Permission mode: Auto\b/i });
    expect(chip.className).toMatch(/--acc-yellow/);
  });

  it("renders 'Build' with fuchsia styling for OpenCode's primary mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.OPENCODE, permissionMode: "acceptEdits" });
    const chip = screen.getByRole("button", { name: /Permission mode: Build/i });
    expect(chip.className).toMatch(/--chip-fuchsia/);
  });

  it("renders 'Default' with blue styling for Codex's primary mode", () => {
    renderChip({ currentProviderId: PROVIDER_IDS.CODEX_CLI, permissionMode: "default" });
    const chip = screen.getByRole("button", { name: /Permission mode: Default/i });
    expect(chip.className).toMatch(/--chip-blue/);
  });

  it("renders 'Full Access' with red styling for Codex when the opt-in toggle is on", () => {
    renderChip({
      currentProviderId: PROVIDER_IDS.CODEX_CLI,
      permissionMode: "bypassPermissions",
      enabledOptInModes: ["bypassPermissions"],
    });
    const chip = screen.getByRole("button", { name: /Permission mode: Full Access/i });
    expect(chip.className).toMatch(/--acc-red/);
  });

  it("hides the chip entirely when no toggle handler is wired (kickoff scenarios)", () => {
    renderChip({ onPermissionModeToggle: undefined });
    expect(screen.queryByRole("button", { name: /Permission mode/i })).toBeNull();
  });
});

describe("MetaBar secondaryBelow", () => {
  it("hides auto-scroll, todos and session-info chips when secondaryBelow is true", () => {
    renderChip({
      secondaryBelow: true,
      showAutoScrollChip: true,
      todos: [{ content: "Do thing", activeForm: "Doing thing", status: "pending" }],
      runtimeProvider: PROVIDER_IDS.CLAUDE_CODE,
      runtimeSessionId: "abc-123",
      onPause: vi.fn(),
    });
    expect(screen.queryByRole("button", { name: /Auto-scroll/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Session info/i })).toBeNull();
    // Todos chip has no accessible name; it's the only button with "1" text.
    expect(screen.queryByText("0/1")).toBeNull();
    // The mode chip (inline) should still render — only the relocated chips are hidden.
    expect(screen.getByRole("button", { name: /Permission mode/i })).toBeInTheDocument();
  });

  it("renders auto-scroll, todos and session-info chips inline when secondaryBelow is false", () => {
    renderChip({
      secondaryBelow: false,
      showAutoScrollChip: true,
      todos: [{ content: "Do thing", activeForm: "Doing thing", status: "pending" }],
      runtimeProvider: PROVIDER_IDS.CLAUDE_CODE,
      runtimeSessionId: "abc-123",
      onPause: vi.fn(),
    });
    expect(screen.getByRole("button", { name: /Auto-scroll/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Session info/i })).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();
  });
});
