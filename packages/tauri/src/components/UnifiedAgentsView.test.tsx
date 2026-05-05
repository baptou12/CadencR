import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { UnifiedAgentsView } from "@/components/UnifiedAgentsView";

const refetchAgents = vi.fn();

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
  };
});

vi.mock("@/components/UnifiedAgentsDynamicFilter", () => ({
  UnifiedAgentsDynamicFilter: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <div>
      <span data-testid="filter-value">{value}</span>
      <button type="button" onClick={() => onValueChange("/sort:")}>
        Insert incomplete sort
      </button>
    </div>
  ),
}));

describe("UnifiedAgentsView filter prompt", () => {
  beforeEach((): void => {
    window.localStorage.clear();
  });

  it("keeps incomplete filter text visible after parsed filters update", async () => {
    const { user } = render(<UnifiedAgentsView />);

    await user.click(screen.getByRole("button", { name: "Insert incomplete sort" }));

    expect(screen.getByTestId("filter-value")).toHaveTextContent("/sort:");
  });
});
