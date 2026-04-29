import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { ProviderDiscovery } from "@/api/generated";
import { ProvidersTab } from "./ProvidersTab";

vi.mock("@/api/generated", () => ({
  useBinaryDiscovery: () => ({
    data: {
      providers: {
        claude: provider("claude"),
        opencode: provider("opencode"),
        codex: provider("codex"),
      },
    },
    isError: false,
    isLoading: false,
  }),
}));

vi.mock("@/api/agentRuntime", () => ({
  DEFAULT_CLAUDE_PROFILE_NAME: "default",
  useClaudeCodeCustomModels: () => ({ data: { models: [] }, isError: false, isLoading: false }),
  useClaudeCodeProfiles: () => ({ data: { active: "default", profiles: [] }, isLoading: false }),
  useDeleteClaudeCodeCustomModel: () => ({ mutate: vi.fn() }),
  useDeleteClaudeCodeProfile: () => ({ mutate: vi.fn() }),
  useSetActiveClaudeCodeProfile: () => ({ mutate: vi.fn() }),
  useUpsertClaudeCodeCustomModel: () => ({ mutate: vi.fn(), isLoading: false }),
  useUpsertClaudeCodeProfile: () => ({ mutate: vi.fn(), isLoading: false }),
}));

function provider(binName: string): ProviderDiscovery {
  return {
    bin_name: binName,
    candidates: [
      {
        canonical: `/usr/local/bin/${binName}`,
        path: `/usr/local/bin/${binName}`,
        source: "env_path",
        version: "1.2.3",
      },
    ],
    override_path: null,
    selected: {
      canonical: `/usr/local/bin/${binName}`,
      path: `/usr/local/bin/${binName}`,
      source: "env_path",
      version: "1.2.3",
    },
  };
}

describe("ProvidersTab", () => {
  it("renders only the active provider details", async () => {
    const { user } = render(<ProvidersTab />);

    expect(screen.getByText("Profiles")).toBeInTheDocument();
    expect(screen.queryByText("codex app-server")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Codex CLI/i }));

    expect(screen.getByText("codex app-server")).toBeInTheDocument();
    expect(screen.queryByText("Profiles")).not.toBeInTheDocument();
  });

  it("shows Codex CLI binary discovery details", async () => {
    const { user } = render(<ProvidersTab />);

    await user.click(screen.getByRole("tab", { name: /Codex CLI/i }));

    expect(screen.getByText("codex app-server")).toBeInTheDocument();
    expect(screen.getAllByText(/\/usr\/local\/bin\/codex/).length).toBeGreaterThan(0);
  });
});
