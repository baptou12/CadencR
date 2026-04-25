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

vi.mock("./CustomActionPopover", () => ({
  CustomActionPopover: () => <div>Action details</div>,
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
      <CustomActionButton action={makeAction()} featureId={42} projectId={1} onEdit={vi.fn()} />,
    );

    await user.click(screen.getByTitle("Run Deploy"));

    expect(mockRunCustomAction).toHaveBeenCalledWith({
      id: 7,
      params: { feature_id: 42 },
    });
  });

  it("opens details from the chevron instead of right click", async (): Promise<void> => {
    const { user } = render(
      <CustomActionButton action={makeAction()} featureId={42} projectId={1} onEdit={vi.fn()} />,
    );

    fireEvent.contextMenu(screen.getByTitle("Run Deploy"));
    expect(screen.queryByText("Action details")).not.toBeInTheDocument();

    await user.click(screen.getByTitle("Open Deploy details"));

    expect(screen.getByText("Action details")).toBeInTheDocument();
  });
});
