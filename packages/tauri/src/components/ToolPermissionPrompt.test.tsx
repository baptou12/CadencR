import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { useHotkeys } from "react-hotkeys-hook";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import type { PendingPermission } from "./ToolPermissionPrompt";

vi.mock("react-hotkeys-hook", async () => {
  const actual = await vi.importActual<typeof import("react-hotkeys-hook")>("react-hotkeys-hook");
  return {
    ...actual,
    useHotkeys: vi.fn(),
  };
});

const mockedUseHotkeys = vi.mocked(useHotkeys);

const permission: PendingPermission = {
  toolName: "Bash",
  input: { command: "ls -la" },
  description: "Run a shell command in your project",
  pattern: "Bash(ls*)",
  options: [
    {
      decision: "allow_once",
      label: "Allow once",
      description: "Approve this tool call only",
      collectFeedback: false,
    },
    {
      decision: "allow_future",
      label: "Always allow",
      description: "Let OpenCode allow similar requests automatically",
      collectFeedback: false,
    },
    { decision: "deny", label: "Deny", description: "Reject this request", collectFeedback: false },
  ],
};

describe("ToolPermissionPrompt", () => {
  beforeEach(() => {
    mockedUseHotkeys.mockClear();
  });

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
    expect(screen.getByText("Always allow")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });

  it("calls onDecision with allow_once when Allow once clicked", async () => {
    const onDecision = vi.fn();
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={onDecision} />,
    );
    await user.click(screen.getByText("Allow once").closest("button")!);
    expect(onDecision).toHaveBeenCalledWith("allow_once");
  });

  it("calls onDecision with allow_future when Allow for future clicked", async () => {
    const onDecision = vi.fn();
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={onDecision} />,
    );
    await user.click(screen.getByText("Always allow").closest("button")!);
    expect(onDecision).toHaveBeenCalledWith("allow_future");
  });

  it("submits deny immediately when feedback is not requested", async () => {
    const onDecision = vi.fn();
    const { user } = render(
      <ToolPermissionPrompt permission={permission} onDecision={onDecision} />,
    );
    await user.click(screen.getByText("Deny").closest("button")!);
    expect(onDecision).toHaveBeenCalledWith("deny", undefined);
    expect(screen.queryByPlaceholderText(/reason for denying/i)).not.toBeInTheDocument();
  });

  it("shows feedback input when deny requests it", async () => {
    const permissionWithFeedback: PendingPermission = {
      ...permission,
      options: permission.options?.map((option) =>
        option.decision === "deny" ? { ...option, collectFeedback: true } : option,
      ),
    };
    const { user } = render(
      <ToolPermissionPrompt permission={permissionWithFeedback} onDecision={vi.fn()} />,
    );
    await user.click(screen.getByText("Deny").closest("button")!);
    expect(screen.getByPlaceholderText(/reason for denying/i)).toBeInTheDocument();
  });

  it("calls onDecision with deny after pressing Enter in feedback", async () => {
    const onDecision = vi.fn();
    const permissionWithFeedback: PendingPermission = {
      ...permission,
      options: permission.options?.map((option) =>
        option.decision === "deny" ? { ...option, collectFeedback: true } : option,
      ),
    };
    const { user } = render(
      <ToolPermissionPrompt permission={permissionWithFeedback} onDecision={onDecision} />,
    );
    await user.click(screen.getByText("Deny").closest("button")!);
    const input = screen.getByPlaceholderText(/reason for denying/i);
    await user.type(input, "Too risky");
    await user.keyboard("{Enter}");
    expect(onDecision).toHaveBeenCalledWith("deny", "Too risky");
  });

  it("shows runtime-specific option description", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    expect(
      screen.getByText("Let OpenCode allow similar requests automatically"),
    ).toBeInTheDocument();
  });

  it("shows nested metadata command preview", () => {
    render(
      <ToolPermissionPrompt
        permission={{
          ...permission,
          preview: "git status",
        }}
        onDecision={vi.fn()}
      />,
    );
    expect(screen.getByText("git status")).toBeInTheDocument();
  });

  it("shows provided path preview", () => {
    render(
      <ToolPermissionPrompt
        permission={{
          ...permission,
          toolName: "external_directory",
          preview: "/etc/hosts",
        }}
        onDecision={vi.fn()}
      />,
    );
    expect(screen.getByText("/etc/hosts")).toBeInTheDocument();
  });

  it("registers meta+y and meta+n hotkeys (no cmd+digit)", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    const hotkeyStrings = mockedUseHotkeys.mock.calls.map((call) => call[0]);
    expect(hotkeyStrings).toContain("meta+y");
    expect(hotkeyStrings).toContain("meta+n");
    // cmd+digit shortcuts must be gone — they're reserved for the sidebar.
    expect(hotkeyStrings.some((s) => /^meta\+\d$/.test(String(s)))).toBe(false);
  });

  it("invoking meta+y handler approves with allow_once", () => {
    const onDecision = vi.fn();
    vi.useFakeTimers();
    try {
      render(<ToolPermissionPrompt permission={permission} onDecision={onDecision} />);
      const yCall = mockedUseHotkeys.mock.calls.find((call) => call[0] === "meta+y")!;
      const handler = yCall[1] as (e: { preventDefault: () => void }) => void;
      handler({ preventDefault: vi.fn() });
      vi.runAllTimers();
      expect(onDecision).toHaveBeenCalledWith("allow_once");
    } finally {
      vi.useRealTimers();
    }
  });

  it("invoking meta+n handler triggers deny flow", () => {
    const onDecision = vi.fn();
    vi.useFakeTimers();
    try {
      render(<ToolPermissionPrompt permission={permission} onDecision={onDecision} />);
      const nCall = mockedUseHotkeys.mock.calls.find((call) => call[0] === "meta+n")!;
      const handler = nCall[1] as (e: { preventDefault: () => void }) => void;
      handler({ preventDefault: vi.fn() });
      vi.runAllTimers();
      expect(onDecision).toHaveBeenCalledWith("deny", undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders cmd+Y badge on Allow once and cmd+N on Deny, no badge on others", () => {
    render(<ToolPermissionPrompt permission={permission} onDecision={vi.fn()} />);
    const allowOnceBtn = screen.getByText("Allow once").closest("button")!;
    const alwaysAllowBtn = screen.getByText("Always allow").closest("button")!;
    const denyBtn = screen.getByText("Deny").closest("button")!;

    expect(allowOnceBtn.querySelector("kbd")).not.toBeNull();
    expect(allowOnceBtn.textContent).toContain("Y");
    expect(denyBtn.querySelector("kbd")).not.toBeNull();
    expect(denyBtn.textContent).toContain("N");
    // "Always allow" (allow_future) gets no shortcut badge
    expect(alwaysAllowBtn.querySelector("kbd")).toBeNull();
  });
});
