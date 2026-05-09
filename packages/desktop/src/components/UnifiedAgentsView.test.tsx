import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ref } from "react";
import { fireEvent, render, screen } from "@/test-utils";
import { UnifiedAgentsView } from "@/components/UnifiedAgentsView";
import { UNIFIED_AGENTS_PER_ROW_SETTING_KEY } from "@/components/UnifiedAgentsPerRowSetting";

const refetchAgents = vi.fn();
const setWorkspaceSettingMutate = vi.fn();
const focusFilterMock = vi.hoisted(() => vi.fn());
let workspaceSettingValue: string | null = null;

vi.mock("@/api/generated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/generated")>();
  return {
    ...actual,
    useGetUnifiedAgents: () => ({
      data: { agents: [] },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: refetchAgents,
    }),
    useListProjects: () => ({
      data: [],
      error: null,
      isError: false,
    }),
    useGetWorkspaceSetting: () => ({
      data: { value: workspaceSettingValue },
      error: null,
      isError: false,
      isLoading: false,
    }),
    useSetWorkspaceSetting: () => ({
      isPending: false,
      mutate: setWorkspaceSettingMutate,
      mutateAsync: setWorkspaceSettingMutate,
    }),
    getGetWorkspaceSettingQueryKey: (key: string) => [`/api/workspace/settings/${key}`],
  };
});

vi.mock("@/components/UnifiedAgentsDynamicFilter", () => ({
  UnifiedAgentsDynamicFilter: ({
    value,
    inputRef,
    onValueChange,
  }: {
    value: string;
    inputRef?: Ref<{ focus: () => void; blur: () => void }>;
    onValueChange: (value: string) => void;
  }) => {
    if (typeof inputRef === "function") inputRef({ focus: focusFilterMock, blur: vi.fn() });
    else if (inputRef) inputRef.current = { focus: focusFilterMock, blur: vi.fn() };
    return (
      <div>
        <span data-testid="filter-value">{value}</span>
        <button type="button" onClick={() => onValueChange("/sort:")}>
          Insert incomplete sort
        </button>
      </div>
    );
  },
}));

describe("UnifiedAgentsView filter prompt", () => {
  beforeEach((): void => {
    window.localStorage.clear();
    workspaceSettingValue = null;
    setWorkspaceSettingMutate.mockClear();
    focusFilterMock.mockClear();
  });

  it("keeps incomplete filter text visible after parsed filters update", async () => {
    const { user } = render(<UnifiedAgentsView />);

    await user.click(screen.getByRole("button", { name: "Insert incomplete sort" }));

    expect(screen.getByTestId("filter-value")).toHaveTextContent("/sort:");
  });

  it("focuses the filter on Cmd+Shift+F while already on unified agents", () => {
    render(<UnifiedAgentsView />);

    fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });

    expect(focusFilterMock).toHaveBeenCalledOnce();
  });

  it("stops duplicate global Cmd+Shift+F handlers after focusing the filter", () => {
    const downstream = vi.fn();
    render(<UnifiedAgentsView />);
    window.addEventListener("keydown", downstream, true);

    fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });

    expect(downstream).not.toHaveBeenCalled();
    window.removeEventListener("keydown", downstream, true);
  });

  it("renders the agents-per-row stepper between the filter and refresh controls", async () => {
    workspaceSettingValue = "4";
    const { user } = render(<UnifiedAgentsView />);

    const filter = screen.getByTestId("filter-value");
    const stepper = screen.getByLabelText("Agents per row");
    const refresh = screen.getByRole("button", { name: "Refresh" });

    expect(filter.compareDocumentPosition(stepper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      stepper.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(stepper).toHaveTextContent("4");

    await user.click(screen.getByRole("button", { name: "Increase agents per row" }));

    expect(setWorkspaceSettingMutate).toHaveBeenCalledWith({
      key: UNIFIED_AGENTS_PER_ROW_SETTING_KEY,
      data: { value: "5" },
    });
  });
});
