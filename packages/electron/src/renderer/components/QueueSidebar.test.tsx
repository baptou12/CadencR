import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { QueueSidebar } from "./QueueSidebar";
import type { QueueItem } from "@/hooks/useWorkflowWebSocket";

// Mock API hooks used by QueueSidebar
vi.mock("@/api/generated", () => ({
  useGetFeaturePlan: vi.fn(() => ({ data: null })),
  useGetFeaturePrd: vi.fn(() => ({ data: null })),
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
  });

  it("renders empty state when queue is empty", () => {
    render(<QueueSidebar {...defaultProps} />);
    expect(screen.getByText("No queue items yet")).toBeInTheDocument();
  });

  it("renders queue items", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "plan", phase_title: "Create plan", order_index: 0 }),
      makeItem({ id: 2, item_type: "execute", phase_title: "Implement feature", order_index: 1 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Create plan")).toBeInTheDocument();
    expect(screen.getByText("Implement feature")).toBeInTheDocument();
  });

  it("shows type labels for items", () => {
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

  it("shows completed/pending/running states", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "execute", phase_title: "Phase A", status: "completed", order_index: 0 }),
      makeItem({ id: 2, item_type: "execute", phase_title: "Phase B", status: "running", order_index: 1 }),
      makeItem({ id: 3, item_type: "execute", phase_title: "Phase C", status: "pending", order_index: 2 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Phase A")).toBeInTheDocument();
    expect(screen.getByText("Phase B")).toBeInTheDocument();
    expect(screen.getByText("Phase C")).toBeInTheDocument();
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
      makeItem({ id: 1, item_type: "execute", phase_title: "Failed phase", status: "error", order_index: 0 }),
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
    render(
      <QueueSidebar {...defaultProps} queue={queue} onRetryItem={onRetryItem} />,
    );
    await user.click(screen.getByText("Retry"));
    expect(onRetryItem).toHaveBeenCalledWith(5);
  });

  it("calls onSkipItem when skip button clicked", async () => {
    const user = userEvent.setup();
    const onSkipItem = vi.fn();
    const queue: QueueItem[] = [
      makeItem({ id: 7, item_type: "execute", status: "error", order_index: 0 }),
    ];
    render(
      <QueueSidebar {...defaultProps} queue={queue} onSkipItem={onSkipItem} />,
    );
    await user.click(screen.getByText("Skip"));
    expect(onSkipItem).toHaveBeenCalledWith(7);
  });

  it("groups items by group_index with step dividers", () => {
    const queue: QueueItem[] = [
      makeItem({ id: 1, item_type: "execute", order_index: 0, group_index: 0 }),
      makeItem({ id: 2, item_type: "execute", order_index: 1, group_index: 0 }),
      makeItem({ id: 3, item_type: "review", order_index: 2, group_index: 1 }),
    ];
    render(<QueueSidebar {...defaultProps} queue={queue} />);
    expect(screen.getByText("Step 1")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
  });
});
