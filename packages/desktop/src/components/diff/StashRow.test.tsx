import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { StashEntry } from "@/api/generated";
import { StashRow } from "./StashRow";
import type { StashMutationCoordinator } from "./useStashMutationCoordinator";

const mocks = vi.hoisted(() => ({
  controller: {
    pendingOperation: null as "apply" | "pop" | "drop" | null,
    apply: vi.fn(),
    pop: vi.fn(),
    drop: vi.fn(),
  },
}));

vi.mock("./useStashMutations", () => ({
  useStashMutations: () => mocks.controller,
}));

const stash: StashEntry = {
  ref_name: "stash@{0}",
  sha: "b".repeat(40),
  message: "Keep this work",
  date: "2026-01-01 12:00:00 +0000",
  files_changed: 1,
  additions: 2,
  deletions: 1,
};

const coordinator: StashMutationCoordinator = {
  activeMutation: null,
  blockedReason: null,
  getBlockedReason: vi.fn(() => null),
  tryAcquire: vi.fn(),
  release: vi.fn(),
};

describe("StashRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.controller.pendingOperation = null;
    mocks.controller.apply.mockResolvedValue(true);
    mocks.controller.pop.mockResolvedValue(true);
    mocks.controller.drop.mockResolvedValue(true);
  });

  it("renders the primary open action beside inline stash actions", async () => {
    const onOpen = vi.fn();
    const { user } = render(
      <StashRow featureId={8} stash={stash} onOpen={onOpen} coordinator={coordinator} />,
    );
    const openButton = screen.getByRole("button", {
      name: "Open stash@{0}: Keep this work",
    });
    const actionGroup = screen.getByRole("group", {
      name: "Actions for stash@{0}: Keep this work",
    });

    expect(openButton.contains(actionGroup)).toBe(false);
    expect(openButton.nextElementSibling).toBe(actionGroup);
    expect(screen.getByRole("button", { name: "Apply stash@{0}" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Pop stash@{0}" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Drop stash@{0}" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply stash@{0}" })).toHaveClass(
      "text-[var(--acc-green)]",
    );
    expect(screen.getByRole("button", { name: "Pop stash@{0}" })).toHaveClass(
      "text-[var(--acc-cyan)]",
    );
    expect(screen.getByRole("button", { name: "Drop stash@{0}" })).toHaveClass(
      "text-[var(--acc-red)]",
    );
    await user.click(openButton);
    expect(onOpen).toHaveBeenCalledWith(stash);
  });

  it("offers Apply and Pop as independent inline actions", async () => {
    const { user } = render(
      <StashRow featureId={8} stash={stash} onOpen={vi.fn()} coordinator={coordinator} />,
    );
    await user.click(screen.getByRole("button", { name: "Apply stash@{0}" }));
    expect(mocks.controller.apply).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Pop stash@{0}" }));
    expect(mocks.controller.pop).toHaveBeenCalledOnce();
  });

  it("confirms Drop with both the stash selector and message", async () => {
    const { user } = render(
      <StashRow featureId={8} stash={stash} onOpen={vi.fn()} coordinator={coordinator} />,
    );
    await user.click(screen.getByRole("button", { name: "Drop stash@{0}" }));

    expect(screen.getByRole("dialog", { name: "Drop stash@{0}?" })).toHaveTextContent(
      "Keep this work",
    );
    expect(mocks.controller.drop).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Drop stash" }));
    expect(mocks.controller.drop).toHaveBeenCalledOnce();
  });

  it("returns focus to the inline Drop action when confirmation is cancelled", async () => {
    const { user } = render(
      <StashRow featureId={8} stash={stash} onOpen={vi.fn()} coordinator={coordinator} />,
    );
    const dropButton = screen.getByRole("button", { name: "Drop stash@{0}" });
    await user.click(dropButton);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(dropButton).toHaveFocus();
  });

  it("keeps an open Drop dialog but blocks confirmation during another row operation", async () => {
    const coordinatorBase = {
      getBlockedReason: vi.fn(() => null),
      tryAcquire: vi.fn(() => ({ featureId: 8, id: 1, owner: { kind: "push" } as const })),
      release: vi.fn(),
    };
    const activeCoordinator: StashMutationCoordinator = {
      ...coordinatorBase,
      activeMutation: null,
      blockedReason: null,
    };
    const { rerender, user } = render(
      <StashRow featureId={8} stash={stash} onOpen={vi.fn()} coordinator={activeCoordinator} />,
    );
    await user.click(screen.getByRole("button", { name: "Drop stash@{0}" }));

    rerender(
      <StashRow
        featureId={8}
        stash={stash}
        onOpen={vi.fn()}
        coordinator={{
          ...coordinatorBase,
          activeMutation: { kind: "row", operation: "apply", stashRefName: "stash@{1}" },
          blockedReason: "Apply stash@{1} in progress",
        }}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Drop stash@{0}?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Drop stash" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("shows the row operation and disables incompatible inline actions while pending", () => {
    mocks.controller.pendingOperation = "pop";
    render(<StashRow featureId={8} stash={stash} onOpen={vi.fn()} coordinator={coordinator} />);

    expect(screen.getByText("pop stash in progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply stash@{0}" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pop stash@{0} in progress" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Drop stash@{0}" })).toBeDisabled();
  });
});
