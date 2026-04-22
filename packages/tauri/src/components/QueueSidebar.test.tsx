import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { QueueSidebar } from "./QueueSidebar";
import type { QueueItem } from "@/types/workflow";

// Hoisted mocks so we can control return values per-test
const { mockGetPlan, mockGetPrd } = vi.hoisted(() => ({
  mockGetPlan: vi.fn<() => { data: unknown }>(() => ({ data: null })),
  mockGetPrd: vi.fn<() => { data: unknown }>(() => ({ data: null })),
}));

// Mock API hooks used by QueueSidebar
vi.mock("@/api/generated", () => ({
  useGetFeaturePlan: mockGetPlan,
  useGetFeaturePrd: mockGetPrd,
}));

// Mock Markdown component
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

function makeItem(overrides: Partial<QueueItem> & { id: number }): QueueItem {
  return {
    item_type: "execute",
    phase_id: null,
    phase_title: null,
    status: "pending",
    order_index: 0,
    group_index: 0,
    agent_session_id: null,
    result: null,
    retry_count: 0,
    max_retries: 0,
    ...overrides,
  };
}

describe("QueueSidebar", () => {
  const defaultProps = {
    queue: [] as QueueItem[],
    featureId: 1,
    selectedItemId: null as number | null,
    onSelectItem: vi.fn(),
  };

  beforeEach(() => {
    defaultProps.onSelectItem.mockClear();
    mockGetPlan.mockReturnValue({ data: null });
    mockGetPrd.mockReturnValue({ data: null });
  });

  // -----------------------------------------------------------------------
  // Empty / null returns
  // -----------------------------------------------------------------------

  it("returns null when queue is empty and no plan/prd", () => {
    const { container } = render(<QueueSidebar {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Synthetic draft items from plan phases
  // -----------------------------------------------------------------------

  it("renders synthetic draft items from plan phases when queue is empty", () => {
    mockGetPlan.mockReturnValue({
      data: {
        id: 1,
        title: "My Plan",
        summary: "A summary",
        phases: [
          {
            id: 10,
            step_number: 1,
            title: "Setup DB",
            phase_type: "execute",
            prompt: null,
            commit_message: null,
            implementation_notes: null,
            deviations: null,
            complexity: null,
            status: "pending",
          },
          {
            id: 11,
            step_number: 2,
            title: "Add API",
            phase_type: "execute",
            prompt: null,
            commit_message: null,
            implementation_notes: null,
            deviations: null,
            complexity: 3,
            status: "pending",
          },
          {
            id: 12,
            step_number: 3,
            title: "Write tests",
            phase_type: "review",
            prompt: null,
            commit_message: null,
            implementation_notes: null,
            deviations: null,
            complexity: null,
            status: "pending",
          },
        ],
      },
    });

    render(<QueueSidebar {...defaultProps} />);

    // Plan header should be visible
    expect(screen.getByText("My Plan")).toBeInTheDocument();
    expect(screen.getByText("A summary")).toBeInTheDocument();

    // Phase titles rendered as draft items
    expect(screen.getByText("Setup DB")).toBeInTheDocument();
    expect(screen.getByText("Add API")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();
  });

  it("does not show progress counter for draft-only items", () => {
    mockGetPlan.mockReturnValue({
      data: {
        id: 1,
        title: "Plan",
        phases: [
          {
            id: 10,
            step_number: 1,
            title: "Phase 1",
            phase_type: "execute",
            prompt: null,
            commit_message: null,
            implementation_notes: null,
            deviations: null,
            complexity: null,
            status: null,
          },
        ],
      },
    });

    render(<QueueSidebar {...defaultProps} />);
    // Progress counter format is "X/Y" — should not appear for drafts
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Real queue items take precedence
  // -----------------------------------------------------------------------

  it("uses real queue items when present, not synthetic drafts", () => {
    mockGetPlan.mockReturnValue({
      data: {
        id: 1,
        title: "Plan",
        phases: [
          {
            id: 10,
            step_number: 1,
            title: "Draft Phase",
            phase_type: "execute",
            prompt: null,
            commit_message: null,
            implementation_notes: null,
            deviations: null,
            complexity: null,
            status: null,
          },
        ],
      },
    });

    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "execute", phase_title: "Real Item", order_index: 0 }),
    ];

    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Real Item")).toBeInTheDocument();
    // Draft phase title should NOT appear as a queue row (it could appear in header though)
    expect(screen.queryByText("Draft Phase")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Step numbers are sequential (gi + 1)
  // -----------------------------------------------------------------------

  it("renders step numbers sequentially based on group position, not group_index value", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "execute", order_index: 0, group_index: 5 }),
      makeItem({ id: 2, item_type: "execute", order_index: 1, group_index: 5 }),
      makeItem({ id: 3, item_type: "review", order_index: 2, group_index: 10 }),
    ];

    render(<QueueSidebar {...defaultProps} queue={queue} />);
    // Even though group_index values are 5 and 10, step labels should be 1 and 2
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.queryByText("Step 5")).not.toBeInTheDocument();
    expect(screen.queryByText("Step 10")).not.toBeInTheDocument();
  });

  it("renders one step per group for sequential group_index values", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "execute", order_index: 0, group_index: 0 }),
      makeItem({ id: 2, item_type: "execute", order_index: 1, group_index: 0 }),
      makeItem({ id: 3, item_type: "review", order_index: 2, group_index: 1 }),
    ];

    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.queryByText("Step 3")).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Existing behavior tests
  // -----------------------------------------------------------------------

  it("renders queue items", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "plan", phase_title: "Create plan", order_index: 0 }),
      makeItem({ id: 2, item_type: "execute", phase_title: "Implement feature", order_index: 1 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Create plan")).toBeInTheDocument();
    expect(screen.getByText("Implement feature")).toBeInTheDocument();
  });

  it("shows type labels for items without titles", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "plan", order_index: 0 }),
      makeItem({ id: 2, item_type: "prd", order_index: 1 }),
      makeItem({ id: 3, item_type: "review", order_index: 2 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("PRD")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("displays progress counter", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, status: "completed", order_index: 0 }),
      makeItem({ id: 2, status: "skipped", order_index: 1 }),
      makeItem({ id: 3, status: "pending", order_index: 2 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("calls onSelectItem when item is clicked", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    const queue: QueueItem[] = [
      makeItem({ id: 42, item_type: "execute", phase_title: "Click me", order_index: 0 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} onSelectItem={onSelectItem} />);
    await user.click(screen.getByText("Click me"));
    expect(onSelectItem).toHaveBeenCalledWith(42);
  });

  it("highlights selected item", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "execute", phase_title: "Selected", order_index: 0 }),
      makeItem({ id: 2, item_type: "execute", phase_title: "Not selected", order_index: 1 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} selectedItemId={1} />);
    const selectedButton = screen.getByText("Selected").closest("button");
    expect(selectedButton).toHaveClass("bg-gray-800/80");
  });

  it("shows retry and skip buttons for error items", () => {
    const onRetryItem = vi.fn();
    const onSkipItem = vi.fn();
    const queue: QueueItem[] = [
      makeItem({
        id: 1,
        item_type: "execute",
        phase_title: "Failed phase",
        status: "error",
        order_index: 0,
      }),
    ];
    render(
      <QueueSidebar
        {...defaultProps}
        queue={queue}
        onRetryItem={onRetryItem}
        onSkipItem={onSkipItem}
      />,
    );
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(screen.getByText("Skip")).toBeInTheDocument();
  });

  it("calls onRetryItem when retry button clicked", async () => {
    const user = userEvent.setup();
    const onRetryItem = vi.fn();
    const queue: QueueItem[] = [
      makeItem({ id: 5, item_type: "execute", status: "error", order_index: 0 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} onRetryItem={onRetryItem} />);
    await user.click(screen.getByText("Retry"));
    expect(onRetryItem).toHaveBeenCalledWith(5);
  });

  it("calls onSkipItem when skip button clicked", async () => {
    const user = userEvent.setup();
    const onSkipItem = vi.fn();
    const queue: QueueItem[] = [
      makeItem({ id: 7, item_type: "execute", status: "error", order_index: 0 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} onSkipItem={onSkipItem} />);
    await user.click(screen.getByText("Skip"));
    expect(onSkipItem).toHaveBeenCalledWith(7);
  });

  // -----------------------------------------------------------------------
  // Unknown status fallback
  // -----------------------------------------------------------------------

  it("renders without crashing when item has an unknown status", () => {
    const queue: QueueItem[] = [
      makeItem({
        id: 1,
        item_type: "execute",
        phase_title: "Mystery",
        status: "unknown_status" as QueueItem["status"],
        order_index: 0,
      }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Mystery")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // PRD button
  // -----------------------------------------------------------------------

  it("shows PRD button when prd data is available", () => {
    mockGetPrd.mockReturnValue({ data: { prd: "# Requirements\nSome PRD content" } });
    // Need plan or queue to avoid returning null
    mockGetPlan.mockReturnValue({
      data: {
        id: 1,
        title: "Plan",
        phases: [
          {
            id: 10,
            step_number: 1,
            title: "P1",
            phase_type: "execute",
            prompt: null,
            commit_message: null,
            implementation_notes: null,
            deviations: null,
            complexity: null,
            status: null,
          },
        ],
      },
    });

    render(<QueueSidebar {...defaultProps} />);
    expect(screen.getByText("PRD")).toBeInTheDocument();
  });
});
