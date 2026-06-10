import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { CustomAction } from "@/api/generated";
import { CustomActionsBar } from "./CustomActionsBar";

const isMobileMock = vi.fn<() => boolean>(() => false);
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => isMobileMock(),
}));

const actionsMock = vi.fn<() => CustomAction[]>(() => []);
vi.mock("@/api/generated", async () => {
  const actual = await vi.importActual<typeof import("@/api/generated")>("@/api/generated");
  return {
    ...actual,
    useListCustomActions: () => ({ data: actionsMock() }),
    useRunCustomAction: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

function makeAction(id: number, name: string): CustomAction {
  return {
    command: "echo hi",
    created_at: "2026-01-01T00:00:00Z",
    id,
    name,
    position: id,
    scope: "global",
    run_in_terminal: false,
    updated_at: "2026-01-01T00:00:00Z",
    variable_names: [],
  };
}

afterEach(() => {
  isMobileMock.mockReturnValue(false);
  actionsMock.mockReturnValue([]);
});

describe("CustomActionsBar", () => {
  it("renders a few actions inline on desktop", () => {
    actionsMock.mockReturnValue([makeAction(1, "Build"), makeAction(2, "Deploy")]);

    render(<CustomActionsBar featureId={42} projectId={7} />);

    expect(screen.getByTitle("Run Build")).toBeInTheDocument();
    expect(screen.getByTitle("Run Deploy")).toBeInTheDocument();
    expect(screen.queryByTitle("More actions")).not.toBeInTheDocument();
  });

  it("collapses every action into the overflow menu on mobile", () => {
    isMobileMock.mockReturnValue(true);
    actionsMock.mockReturnValue([makeAction(1, "Build"), makeAction(2, "Deploy")]);

    render(<CustomActionsBar featureId={42} projectId={7} />);

    expect(screen.getByTitle("More actions")).toBeInTheDocument();
    expect(screen.queryByTitle("Run Build")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Run Deploy")).not.toBeInTheDocument();
  });
});
