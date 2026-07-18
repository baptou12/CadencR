import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { StashChangesDialog } from "./StashChangesDialog";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  pending: false,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@/api/generated", () => ({
  usePushStash: () => ({ mutateAsync: mocks.mutateAsync, isPending: mocks.pending }),
}));

describe("StashChangesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pending = false;
    mocks.mutateAsync.mockResolvedValue({ outcome: "completed" });
  });

  it("states the tracked-files-only contract and submits a trimmed optional name", async () => {
    const onOpenChange = vi.fn();
    const onCompleted = vi.fn();
    const { user } = render(
      <StashChangesDialog
        featureId={21}
        open
        onOpenChange={onOpenChange}
        onCompleted={onCompleted}
      />,
    );

    expect(screen.getByText("Tracked files only.")).toBeInTheDocument();
    expect(
      screen.getByText(/untracked and ignored files stay in the worktree/i),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Name/ }), "  parser WIP  ");
    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      data: { feature_id: 21, message: "parser WIP" },
    });
    expect(onCompleted).toHaveBeenCalledWith({
      outcome: "completed",
      featureId: 21,
      name: "parser WIP",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("creates an unnamed stash when the optional name is blank", async () => {
    const onCompleted = vi.fn();
    const { user } = render(
      <StashChangesDialog featureId={22} open onOpenChange={vi.fn()} onCompleted={onCompleted} />,
    );

    await user.type(screen.getByRole("textbox", { name: /Name/ }), "   ");
    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      data: { feature_id: 22, message: null },
    });
    expect(onCompleted).toHaveBeenCalledWith({
      outcome: "completed",
      featureId: 22,
      name: null,
    });
  });

  it("shows pending state and disables closing actions", () => {
    mocks.pending = true;
    render(<StashChangesDialog featureId={23} open onOpenChange={vi.fn()} />);

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("textbox", { name: /Name/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stashing…" })).toBeDisabled();
  });

  it("surfaces the clean or untracked-only backend error inline and stays open", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("No tracked changes are available to stash"));
    const onOpenChange = vi.fn();
    const { user } = render(<StashChangesDialog featureId={24} open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tracked changes are available to stash",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not close until the backend confirms creation", async () => {
    let complete: ((value: { outcome: "completed" }) => void) | undefined;
    mocks.mutateAsync.mockReturnValue(
      new Promise<{ outcome: "completed" }>((resolve) => {
        complete = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    const { user } = render(<StashChangesDialog featureId={25} open onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Stash changes" }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    complete?.({ outcome: "completed" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("does not misreport a completed stash when the follow-up callback fails", async () => {
    const onOpenChange = vi.fn();
    const onCompleted = vi.fn(() => {
      throw new Error("route failed");
    });
    const { user } = render(
      <StashChangesDialog
        featureId={26}
        open
        onOpenChange={onOpenChange}
        onCompleted={onCompleted}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stash changes" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Stashed changes, but the follow-up action failed",
      expect.objectContaining({ description: "route failed" }),
    );
  });
});
