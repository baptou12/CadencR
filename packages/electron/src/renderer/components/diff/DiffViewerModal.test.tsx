import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";

const mocks = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockListQuery = vi.fn(() => ({ data: [] })) as any;
  const mockMarkAsSent = vi.fn(() => ({ mutateAsync: vi.fn() }));
  const mockDeletePending = vi.fn(() => ({ mutateAsync: vi.fn() }));
  const mockSendMessage = vi.fn(() => ({ mutateAsync: vi.fn() }));
  const mockSubmitAnswers = vi.fn(() => ({ mutateAsync: vi.fn() }));
  const mockInvalidate = vi.fn();
  return {
    mockListQuery,
    mockMarkAsSent,
    mockDeletePending,
    mockSendMessage,
    mockSubmitAnswers,
    mockInvalidate,
  };
});

// Mock child DiffViewer (complex, tested separately)
vi.mock("./DiffViewer", () => ({
  DiffViewer: ({ featureId }: { featureId: number }) => (
    <div data-testid="diff-viewer">DiffViewer for feature {featureId}</div>
  ),
}));

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      useUtils: vi.fn(() => ({
        diffComments: { list: { invalidate: mocks.mockInvalidate } },
      })),
      diffComments: {
        list: { useQuery: mocks.mockListQuery },
        markAsSent: { useMutation: mocks.mockMarkAsSent },
        deletePending: { useMutation: mocks.mockDeletePending },
      },
      agents: {
        sendMessage: { useMutation: mocks.mockSendMessage },
        submitAnswers: { useMutation: mocks.mockSubmitAnswers },
      },
    },
  };
});

import { DiffViewerModal } from "./DiffViewerModal";

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

  it("shows send button when there are pending comments", () => {
    mocks.mockListQuery.mockReturnValue({
      data: [
        {
          id: 1, // eslint-disable-line
          feature_id: 1,
          file_path: "src/foo.ts",
          line_number: 1,
          side: "new",
          content: "Fix this",
          status: "pending",
          created_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    render(
      <DiffViewerModal featureId={1} open={true} onOpenChange={vi.fn()} />,
    );
    expect(screen.getByText(/1 comment/)).toBeInTheDocument();
  });

  it("disables send button when no pending comments", () => {
    render(
      <DiffViewerModal featureId={1} open={true} onOpenChange={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: /0 comments/ });
    expect(btn).toBeDisabled();
  });

  it("hides footer when hideFooter is true", () => {
    render(
      <DiffViewerModal
        featureId={1}
        open={true}
        onOpenChange={vi.fn()}
        hideFooter={true}
      />,
    );
    expect(screen.queryByRole("button", { name: /comment/ })).not.toBeInTheDocument();
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
