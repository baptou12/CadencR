import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { PROVIDER_IDS } from "@/lib/providers";
import { SessionInfoChip, SessionInfoMcpServersProvider } from "./SessionInfoChip";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

describe("SessionInfoChip", () => {
  it("renders MCP servers above the Claude profile row", async () => {
    const user = userEvent.setup();

    render(
      <SessionInfoMcpServersProvider
        mcpServers={[
          { name: "cadencr-browser", status: "connected" },
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
    const profileHeading = screen.getByText("Claude profile");
    expect(mcpHeading.compareDocumentPosition(profileHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByText("cadencr-browser")).toBeInTheDocument();
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

  it("bounds the popover and virtualizes a long MCP server list", async () => {
    const user = userEvent.setup();
    const mcpServers = Array.from({ length: 30 }, (_, index) => ({
      name: `server-${index}`,
      status: "connected",
    }));

    render(
      <SessionInfoMcpServersProvider mcpServers={mcpServers}>
        <SessionInfoChip
          runtimeProvider={PROVIDER_IDS.CODEX_CLI}
          runtimeSessionId="thread-123"
          projectPath="/tmp/project"
          isRunning={false}
          onPause={vi.fn()}
          chipClass="chip"
        />
      </SessionInfoMcpServersProvider>,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));

    const popover = document.querySelector('[data-slot="popover-content"]');
    expect(popover).toHaveClass(
      "max-h-[min(70vh,var(--radix-popover-content-available-height))]",
      "overflow-hidden",
    );
    const serverList = screen.getByRole("list", { name: "MCP servers" });
    expect(serverList).toHaveClass("max-h-40", "overflow-hidden");
    expect(serverList).toHaveStyle({ height: "160px" });
    expect(serverList.firstElementChild).toHaveClass("h-full", "overscroll-contain");
    expect(screen.getByText("server-29")).toBeInTheDocument();
  });

  it("filters MCP servers by name", async () => {
    const user = userEvent.setup();

    render(
      <SessionInfoMcpServersProvider
        mcpServers={[
          { name: "cadencr-browser", status: "connected" },
          { name: "filesystem", status: "connected" },
        ]}
      >
        <SessionInfoChip
          runtimeProvider={PROVIDER_IDS.CODEX_CLI}
          runtimeSessionId="thread-123"
          projectPath="/tmp/project"
          isRunning={false}
          onPause={vi.fn()}
          chipClass="chip"
        />
      </SessionInfoMcpServersProvider>,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));
    await user.type(screen.getByRole("textbox", { name: "Search MCP servers" }), "FILESYSTEM");

    expect(screen.getByText("filesystem")).toBeInTheDocument();
    expect(screen.queryByText("cadencr-browser")).not.toBeInTheDocument();
  });

  it("renders an editable Claude profile combobox in the info popover", async () => {
    const user = userEvent.setup();
    const onProfileChange = vi.fn();

    render(
      <SessionInfoChip
        runtimeProvider={PROVIDER_IDS.CLAUDE_CODE}
        runtimeSessionId="sess-123"
        projectPath="/tmp/project"
        isRunning={false}
        onPause={vi.fn()}
        chipClass="chip"
        claudeProfile="default"
        claudeProfiles={[{ name: "bedrock", env: {} }]}
        onClaudeProfileChange={onProfileChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));
    await user.click(screen.getByRole("combobox", { name: /Claude profile/i }));
    await user.click(await screen.findByRole("option", { name: "bedrock" }));

    expect(onProfileChange).toHaveBeenCalledWith("bedrock");
  });

  it("says which profile stays active when the session overrides it", async () => {
    const user = userEvent.setup();

    render(
      <SessionInfoChip
        runtimeProvider={PROVIDER_IDS.CLAUDE_CODE}
        runtimeSessionId="sess-123"
        projectPath="/tmp/project"
        isRunning={false}
        onPause={vi.fn()}
        chipClass="chip"
        claudeProfile="bedrock"
        claudeProfiles={[{ name: "bedrock", env: {} }]}
        activeClaudeProfile="default"
        onClaudeProfileChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));

    expect(screen.getByText(/“Default” stays the active profile/)).toBeInTheDocument();
  });

  it("omits the override sentence when the session runs the active profile", async () => {
    const user = userEvent.setup();

    render(
      <SessionInfoChip
        runtimeProvider={PROVIDER_IDS.CLAUDE_CODE}
        runtimeSessionId="sess-123"
        projectPath="/tmp/project"
        isRunning={false}
        onPause={vi.fn()}
        chipClass="chip"
        claudeProfile="default"
        claudeProfiles={[{ name: "bedrock", env: {} }]}
        // Spelled differently on purpose: the alias must not read as an override.
        activeClaudeProfile="default (recommended)"
        onClaudeProfileChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /session info/i }));

    expect(screen.queryByText(/stays the active profile/)).not.toBeInTheDocument();
  });
});
