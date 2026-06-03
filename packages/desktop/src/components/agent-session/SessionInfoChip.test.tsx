import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PROVIDER_IDS } from "@/lib/providers";
import { SessionInfoChip, SessionInfoMcpServersProvider } from "./SessionInfoChip";

vi.mock("@/api/agentRuntime", () => ({
  useClaudeCodeProfiles: vi.fn(() => ({
    data: { active: "default" },
    isLoading: false,
    isError: false,
  })),
}));

describe("SessionInfoChip", () => {
  it("renders MCP servers above the Claude profile row", async () => {
    const user = userEvent.setup();

    render(
      <SessionInfoMcpServersProvider
        mcpServers={[
          { name: "cadencr-session", status: "connected" },
          { name: "filesystem", status: "unavailable" },
          { name: "browser", status: "unknown" },
        ]}
      >
        <SessionInfoChip
          runtimeProvider={PROVIDER_IDS.CLAUDE_CODE}
          runtimeSessionId="sess-123"
          projectPath="/tmp/project"
          isRunning={false}
          onPause={vi.fn()}
          chipClass="chip"
        />
      </SessionInfoMcpServersProvider>,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));

    const mcpHeading = screen.getByText("MCP servers");
    const profileHeading = screen.getByText("Active profile");
    expect(mcpHeading.compareDocumentPosition(profileHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("cadencr-session")).toBeInTheDocument();
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.getByText("filesystem")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText("browser")).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("renders a not-reported state before MCP status is available", async () => {
    const user = userEvent.setup();

    render(
      <SessionInfoChip
        runtimeProvider={PROVIDER_IDS.CODEX_CLI}
        runtimeSessionId="thread-123"
        projectPath="/tmp/project"
        isRunning={false}
        onPause={vi.fn()}
        chipClass="chip"
      />,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));

    expect(screen.getByText("MCPs not reported yet")).toBeInTheDocument();
  });
});
