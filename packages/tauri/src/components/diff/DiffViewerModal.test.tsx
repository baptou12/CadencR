import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";

const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockListQuery = vi.fn(() => ({ data: [] })) as any;
  const mockDeletePending = vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ deleted: 0 }) }));
  return {
    mockListQuery,
    mockDeletePending,
  };
});

vi.mock("@/api/generated", () => ({
  useListDiffComments: mocks.mockListQuery,
  useDeletePendingDiffComments: mocks.mockDeletePending,
}));

// Mock child DiffViewer (complex, tested separately)
vi.mock("./DiffViewer", () => ({
  DiffViewer: ({ featureId }: { featureId: number }) => (
    <div data-testid="diff-viewer">DiffViewer for feature {featureId}</div>
  ),
}));

import { DiffViewerModal } from "./DiffViewerModal";

const pendingComment = {
  id: 1,
  feature_id: 1,
  file_path: "src/foo.ts",
  line_number: 1,
  side: "new",
  content: "Fix this",
  status: "pending",
  created_at: "2024-01-01T00:00:00.000Z",
};

describe("DiffViewerModal", () => {
  beforeEach(() => {
    mocks.mockListQuery.mockReturnValue({ data: [] });
  });

  it("does not render when closed", () => {
    render(
      <DiffViewerModal featureId={1} open={false} onOpenChange={vi.fn()} />,
    );
    expect(screen.queryByText("Diff Viewer")).not.toBeInTheDocument();
  });

  it("renders modal when open", () => {
    render(
      <DiffViewerModal featureId={1} open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText("Diff Viewer")).toBeInTheDocument();
  });

  it("renders the DiffViewer inside", () => {
    render(
      <DiffViewerModal featureId={42} open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
    expect(screen.getByText("DiffViewer for feature 42")).toBeInTheDocument();
  });

  it("shows send button when onSendComments is provided and pending comments exist", () => {
    mocks.mockListQuery.mockReturnValue({ data: [pendingComment] });
    render(
      <DiffViewerModal
        featureId={1}
        open={true}
        onOpenChange={vi.fn()}
        onSendComments={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Send 1 comment/ })).toBeInTheDocument();
  });

  it("disables send button when no pending comments", () => {
    render(
      <DiffViewerModal
        featureId={1}
        open={true}
        onOpenChange={vi.fn()}
        onSendComments={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /Send 0 comments/ });
    expect(btn).toBeDisabled();
  });

  it("hides footer when onSendComments is not provided", () => {
    mocks.mockListQuery.mockReturnValue({ data: [pendingComment] });
    render(
      <DiffViewerModal featureId={1} open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /comment/ })).not.toBeInTheDocument();
  });

  it("calls onSendComments with formatted message and closes modal on click", async () => {
    mocks.mockListQuery.mockReturnValue({ data: [pendingComment] });
    const onSendComments = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <DiffViewerModal
        featureId={1}
        open={true}
        onOpenChange={onOpenChange}
        onSendComments={onSendComments}
      />,
    );
    const btn = screen.getByRole("button", { name: /Send 1 comment/ });
    fireEvent.click(btn);
    await vi.waitFor(() => {
      expect(onSendComments).toHaveBeenCalledWith(expect.stringContaining("src/foo.ts"));
    });
    await vi.waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("calls onOpenChange when close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <DiffViewerModal featureId={1} open={true} onOpenChange={onOpenChange} />,
    );
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
