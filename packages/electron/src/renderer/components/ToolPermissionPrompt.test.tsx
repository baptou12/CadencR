import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import type { PendingPermission } from "./ToolPermissionPrompt";

const permission: PendingPermission = {
  toolName: "Bash",
  input: { command: "ls -la" },
  description: "Run a shell command in your project",
  pattern: "Bash(ls*)",
};

describe("ToolPermissionPrompt", () => {
  it("renders tool name", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("renders description", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    expect(screen.getByText("Run a shell command in your project")).toBeInTheDocument();
  });

  it("renders three permission options", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Allow for future use")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });

  it("calls onDecision with allow_once when Allow once clicked", async () => {
    const onDecision = vi.fn();
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={onDecision} />
    );
    await user.click(screen.getByText("Allow once").closest("button")!);
    expect(onDecision).toHaveBeenCalledWith("allow_once");
  });

  it("calls onDecision with allow_future when Allow for future clicked", async () => {
    const onDecision = vi.fn();
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={onDecision} />
    );
    await user.click(screen.getByText("Allow for future use").closest("button")!);
    expect(onDecision).toHaveBeenCalledWith("allow_future");
  });

  it("shows feedback input when deny clicked", async () => {
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />
    );
    await user.click(screen.getByText("Deny").closest("button")!);
    expect(screen.getByPlaceholderText(/reason for denying/i)).toBeInTheDocument();
  });

  it("calls onDecision with deny after pressing Enter in feedback", async () => {
    const onDecision = vi.fn();
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={onDecision} />
    );
    await user.click(screen.getByText("Deny").closest("button")!);
    const input = screen.getByPlaceholderText(/reason for denying/i);
    await user.type(input, "Too risky");
    await user.keyboard("{Enter}");
    expect(onDecision).toHaveBeenCalledWith("deny", "Too risky");
  });

  it("shows permission pattern in allow for future description", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    expect(screen.getByText("Bash(ls*)")).toBeInTheDocument();
  });
});
