import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@/test-utils";
import { CustomActionButton } from "./CustomActionButton";
import type { CustomAction } from "@/api/generated";

const mockRunCustomAction = vi.hoisted(() => vi.fn());

vi.mock("@/api/generated", () => ({
  getGetCustomActionRunsQueryKey: vi.fn(() => ["custom-action-runs"]),
  getListCustomActionsQueryKey: vi.fn(() => ["custom-actions"]),
  useRunCustomAction: vi.fn(() => ({ mutate: mockRunCustomAction, isPending: false })),
}));

function makeAction(): CustomAction {
  return {
    id: 7,
    name: "Deploy",
    command: "pnpm deploy",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    position: 0,
    scope: "project",
    project_id: 1,
    variable_names: [],
    icon_data: null,
    last_run: null,
  };
}

describe("CustomActionButton", () => {
  beforeEach((): void => {
    mockRunCustomAction.mockClear();
  });

  it("runs the action from the main icon button", async (): Promise<void> => {
    const { user } = render(
      <CustomActionButton
        action={makeAction()}
        featureId={42}
        projectId={1}
        onOpenDetails={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle("Run Deploy"));

    expect(mockRunCustomAction).toHaveBeenCalledWith({
      id: 7,
      params: { feature_id: 42 },
    });
  });

  it("opens the shared details surface from the chevron, not from right click", async (): Promise<void> => {
    const onOpenDetails = vi.fn();
    const action = makeAction();
    const { user } = render(
      <CustomActionButton
        action={action}
        featureId={42}
        projectId={1}
        onOpenDetails={onOpenDetails}
      />,
    );

    fireEvent.contextMenu(screen.getByTitle("Run Deploy"));
    expect(onOpenDetails).not.toHaveBeenCalled();

    await user.click(screen.getByTitle("Open Deploy details"));

    expect(onOpenDetails).toHaveBeenCalledWith(action);
  });
});
