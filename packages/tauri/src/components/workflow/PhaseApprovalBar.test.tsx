import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";

// Mock hooks used by component
vi.mock("@/hooks/useGlobalShortcut", () => ({
  useGlobalShortcut: vi.fn(),
}));

vi.mock("@/components/KbdShortcut", () => ({
  KbdShortcut: ({ keys }: { keys: string[] }) => <span data-testid="kbd">{keys.join("+")}</span>,
}));

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

import { PhaseApprovalBar } from "./PhaseApprovalBar";

describe("PhaseApprovalBar", () => {
  const defaultProps = {
    phaseName: "Planning",
    artifactContent: "# Plan\nSome content",
    onApprove: vi.fn(),
    onReject: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders phase name", () => {
    render(<PhaseApprovalBar {...defaultProps} />);
    expect(screen.getByText(/Planning/)).toBeInTheDocument();
  });

  it("renders approve button", () => {
    render(<PhaseApprovalBar {...defaultProps} />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
  });

  it("calls onApprove when approve button clicked", async () => {
    const onApprove = vi.fn();
    const { user } = render(<PhaseApprovalBar {...defaultProps} onApprove={onApprove} />);
    await user.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("shows feedback textarea after Request Changes click", async () => {
    const { user } = render(<PhaseApprovalBar {...defaultProps} />);
    await user.click(screen.getByText("Request Changes"));
    expect(screen.getByPlaceholderText(/describe what should be changed/i)).toBeInTheDocument();
  });

  it("calls onReject with feedback text when submitted", async () => {
    const onReject = vi.fn();
    const { user } = render(<PhaseApprovalBar {...defaultProps} onReject={onReject} />);
    await user.click(screen.getByText("Request Changes"));
    const textarea = screen.getByPlaceholderText(/describe what should be changed/i);
    await user.type(textarea, "Need more detail");
    // Click send button
    const sendButton = screen.getByRole("button", { name: "" }); // icon-only send button
    await user.click(sendButton);
    expect(onReject).toHaveBeenCalledWith("Need more detail");
  });

  it("shows View Artifact button when artifact content provided", () => {
    render(<PhaseApprovalBar {...defaultProps} />);
    expect(screen.getByText("View Artifact")).toBeInTheDocument();
  });

  it("shows reject button", () => {
    render(<PhaseApprovalBar {...defaultProps} />);
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("calls onReject with empty string when reject clicked", async () => {
    const onReject = vi.fn();
    const { user } = render(<PhaseApprovalBar {...defaultProps} onReject={onReject} />);
    await user.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalledWith("");
  });
});
