import { fireEvent, render, screen } from "@/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShortcutOverridesStore } from "@/lib/shortcuts/overrides";
import { GitSendCommentsBar } from "./GitSendCommentsBar";

describe("GitSendCommentsBar", () => {
  afterEach(() => useShortcutOverridesStore.getState().resetAll());

  it("sends the selected review threads directly", () => {
    const onSend = vi.fn();
    render(
      <GitSendCommentsBar reviews={{ selectedCount: 2, totalCount: 5, disabled: false, onSend }} />,
    );

    expect(screen.getByText("2 of 5 threads picked for the agent")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Send 2 threads" }));

    expect(onSend).toHaveBeenCalledOnce();
  });

  it("keeps the direct action visible but disabled until a thread is selected", () => {
    render(
      <GitSendCommentsBar
        reviews={{ selectedCount: 0, totalCount: 3, disabled: true, onSend: vi.fn() }}
      />,
    );

    expect(screen.getByRole("button", { name: "Send 0 threads" })).toBeDisabled();
    expect(screen.getByText("0 of 3 threads picked for the agent")).toBeVisible();
  });

  it("shows the resolved review shortcut instead of a hardcoded chord", () => {
    useShortcutOverridesStore.getState().setOverride("diff-send-review-comments", { keys: ["f2"] });
    render(
      <GitSendCommentsBar
        reviews={{ selectedCount: 1, totalCount: 3, disabled: false, onSend: vi.fn() }}
      />,
    );

    const button = screen.getByRole("button", { name: "Send 1 thread" });
    fireEvent.mouseEnter(button.closest("div.relative")!);

    expect(screen.getByText("Send picked threads to the agent").parentElement).toHaveTextContent(
      "F2",
    );
  });
});
