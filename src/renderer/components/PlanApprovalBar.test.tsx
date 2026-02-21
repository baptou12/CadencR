import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PlanApprovalBar } from "./PlanApprovalBar";

describe("PlanApprovalBar", () => {
  it("renders plan ready heading", () => {
    render(
      <PlanApprovalBar onApprove={vi.fn()} onRequestChanges={vi.fn()} />
    );
    expect(screen.getByText("Plan ready for review")).toBeInTheDocument();
  });

  it("renders approve button", () => {
    render(
      <PlanApprovalBar onApprove={vi.fn()} onRequestChanges={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /approve & execute/i })).toBeInTheDocument();
  });

  it("renders custom approveLabel", () => {
    render(
      <PlanApprovalBar
        approveLabel="Execute Now"
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /execute now/i })).toBeInTheDocument();
  });

  it("calls onApprove when approve clicked", async () => {
    const onApprove = vi.fn();
    const { user } = render(
      <PlanApprovalBar onApprove={onApprove} onRequestChanges={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("shows feedback textarea after request changes click", async () => {
    const { user } = render(
      <PlanApprovalBar onApprove={vi.fn()} onRequestChanges={vi.fn()} />
    );
    await user.click(screen.getByRole("button", { name: /request changes/i }));
    expect(screen.getByPlaceholderText(/describe the changes/i)).toBeInTheDocument();
  });

  it("calls onRequestChanges with feedback text", async () => {
    const onRequestChanges = vi.fn();
    const { user } = render(
      <PlanApprovalBar onApprove={vi.fn()} onRequestChanges={onRequestChanges} />
    );
    await user.click(screen.getByRole("button", { name: /request changes/i }));
    await user.type(screen.getByPlaceholderText(/describe the changes/i), "Need more tests");
    await user.click(screen.getByRole("button", { name: "" })); // send button (icon only)
    expect(onRequestChanges).toHaveBeenCalledWith("Need more tests");
  });

  it("shows allowed prompts when provided", () => {
    render(
      <PlanApprovalBar
        allowedPrompts={[{ tool: "Bash", prompt: "run tests" }]}
        onApprove={vi.fn()}
        onRequestChanges={vi.fn()}
      />
    );
    expect(screen.getByText("run tests")).toBeInTheDocument();
  });
});
