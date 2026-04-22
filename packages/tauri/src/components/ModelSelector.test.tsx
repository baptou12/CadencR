import React from "react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { ModelSelector } from "./ModelSelector";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const invalidateQueries = vi.fn();
const workspaceProviderMutate = vi.fn();
const projectProviderMutate = vi.fn();

const {
  mockGetGlobalSettings,
  mockGetProjectSettings,
  mockGetFeatureSettings,
  mockGetWorkspaceProviderSettings,
  mockGetProjectProviderSettings,
  mockGetFeatureProviderSettings,
  mockAgentCatalog,
  workspaceProviderMutationImpl,
  projectProviderMutationImpl,
} = vi.hoisted(() => ({
  mockGetGlobalSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetProjectSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetFeatureSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetWorkspaceProviderSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetProjectProviderSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockGetFeatureProviderSettings: vi.fn(() => ({ data: {}, isLoading: false })),
  mockAgentCatalog: vi.fn<() => { data?: unknown; isLoading: boolean; error: unknown | null }>(
    () => ({
      data: {
        default_provider: "claude_code",
        providers: [
          {
            id: "claude_code",
            label: "Claude Code",
            status: "available",
            models: [{ id: "opus", label: "Opus" }],
            default_model: "opus",
          },
          {
            id: "codex_cli",
            label: "Codex CLI",
            status: "coming_soon",
            models: [],
            default_model: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    }),
  ),
  workspaceProviderMutationImpl: vi.fn(
    (options?: {
      onSuccess?: (_data: unknown, vars: { agentType: string; providerId: string }) => void;
      onError?: (_error: unknown, vars: { agentType: string; providerId: string }) => void;
    }) => ({
      mutate: (variables: { agentType: string; providerId: string }) => {
        workspaceProviderMutate(variables);
        options?.onSuccess?.({}, variables);
      },
    }),
  ),
  projectProviderMutationImpl: vi.fn(
    (options?: {
      onSuccess?: (
        _data: unknown,
        vars: { projectId: number; providerType: string; provider: string },
      ) => void;
      onError?: (
        _error: unknown,
        vars: { projectId: number; providerType: string; provider: string },
      ) => void;
    }) => ({
      mutate: (variables: { projectId: number; providerType: string; provider: string }) => {
        projectProviderMutate(variables);
        options?.onSuccess?.({}, variables);
      },
    }),
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("../api/generated", () => ({
  useGetWorkspaceModelSettings: () => mockGetGlobalSettings(),
  useSetWorkspaceModelSetting: vi.fn(() => ({ mutate: vi.fn() })),
  getGetWorkspaceModelSettingsQueryKey: vi.fn(() => ["workspace", "model-settings"]),
  useGetProjectModelSettings: () => mockGetProjectSettings(),
  useGetProjectSettings: () => ({ data: [], isLoading: false }),
  useSetProjectModelSetting: vi.fn(() => ({ mutate: vi.fn() })),
  getGetProjectModelSettingsQueryKey: vi.fn((id: number) => ["project", "model-settings", id]),
  getGetProjectSettingsQueryKey: vi.fn((id: number) => ["project", "settings", id]),
  useGetFeatureModelSettings: () => mockGetFeatureSettings(),
  useGetFeatureSettings: () => ({ data: [], isLoading: false }),
  useSetFeatureModelSetting: vi.fn(() => ({ mutate: vi.fn() })),
  useSetWorkspaceSetting: vi.fn(() => ({ mutate: vi.fn() })),
  useSetProjectSetting: vi.fn(() => ({ mutate: vi.fn() })),
  useSetFeatureSetting: vi.fn(() => ({ mutate: vi.fn() })),
  getGetFeatureModelSettingsQueryKey: vi.fn((id: number) => ["features", "model-settings", id]),
  getGetFeatureSettingsQueryKey: vi.fn((id: number) => ["features", "settings", id]),
}));

vi.mock("@/api/settings", () => ({
  useGetWorkspaceSettings: () => ({ data: [], isLoading: false }),
  getWorkspaceSettingsQueryKey: () => ["workspace", "settings"],
  settingsArrayToMap: () => ({}),
}));

vi.mock("../api/agentRuntime", () => ({
  useAgentCatalog: () => mockAgentCatalog(),
  useGetWorkspaceProviderSettings: () => mockGetWorkspaceProviderSettings(),
  useGetProjectProviderSettings: () => mockGetProjectProviderSettings(),
  useGetFeatureProviderSettings: () => mockGetFeatureProviderSettings(),
  useSetWorkspaceProviderSetting: (options?: unknown) =>
    workspaceProviderMutationImpl(options as never),
  useSetProjectProviderSetting: (options?: unknown) =>
    projectProviderMutationImpl(options as never),
  useSetFeatureProviderSetting: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries })),
  };
});

describe("ModelSelector", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    invalidateQueries.mockReset();
    workspaceProviderMutate.mockReset();
    projectProviderMutate.mockReset();
    workspaceProviderMutationImpl.mockReset();
    projectProviderMutationImpl.mockReset();
    workspaceProviderMutationImpl.mockImplementation((options) => ({
      mutate: (variables) => {
        workspaceProviderMutate(variables);
        options?.onSuccess?.({}, variables);
      },
    }));
    projectProviderMutationImpl.mockImplementation((options) => ({
      mutate: (variables) => {
        projectProviderMutate(variables);
        options?.onSuccess?.({}, variables);
      },
    }));
    mockGetGlobalSettings.mockReturnValue({ data: {}, isLoading: false });
    mockGetProjectSettings.mockReturnValue({ data: {}, isLoading: false });
    mockGetFeatureSettings.mockReturnValue({ data: {}, isLoading: false });
    mockGetWorkspaceProviderSettings.mockReturnValue({ data: {}, isLoading: false });
    mockGetProjectProviderSettings.mockReturnValue({ data: {}, isLoading: false });
    mockGetFeatureProviderSettings.mockReturnValue({ data: {}, isLoading: false });
    mockAgentCatalog.mockReturnValue({
      data: {
        default_provider: "claude_code",
        providers: [
          {
            id: "claude_code",
            label: "Claude Code",
            status: "available",
            models: [{ id: "opus", label: "Opus" }],
            default_model: "opus",
          },
          {
            id: "codex_cli",
            label: "Codex CLI",
            status: "coming_soon",
            models: [],
            default_model: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("renders agent type labels", () => {
    render(<ModelSelector level="global" />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders selects for all agent types", () => {
    render(<ModelSelector level="global" />);
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(7);
  });

  it("shows an error state when the provider catalog fails", () => {
    mockAgentCatalog.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("boom"),
    });
    render(<ModelSelector level="global" />);
    expect(screen.getByText("Failed to load provider catalog.")).toBeInTheDocument();
  });

  it("renders at project level without errors", () => {
    render(<ModelSelector level="project" projectId={1} />);
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("renders at feature level without errors", () => {
    render(<ModelSelector level="feature" featureId={1} projectId={1} />);
    expect(screen.getByText("Execute")).toBeInTheDocument();
  });

  it("uses mutation callbacks so provider success and error toasts track the actual result", async () => {
    const user = userEvent.setup();
    mockGetProjectProviderSettings.mockReturnValue({
      data: { plan: "claude_code" },
      isLoading: false,
    });
    projectProviderMutationImpl.mockImplementation((options) => ({
      mutate: (variables) => {
        projectProviderMutate(variables);
        options?.onError?.(new Error("failed"), variables);
      },
    }));

    render(<ModelSelector level="project" projectId={42} />);
    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(screen.getByText("Inherit selection"));

    expect(projectProviderMutate).toHaveBeenCalledWith({
      projectId: 42,
      providerType: "plan",
      provider: "",
    });
    expect(toastError).toHaveBeenCalledWith("Failed to save provider setting");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("renders coming soon providers as disabled", async () => {
    const user = userEvent.setup();
    render(<ModelSelector level="global" />);

    await user.click(screen.getAllByRole("combobox")[0]);

    const disabledProvider = screen.getByText("Codex CLI (Coming soon)");
    expect(disabledProvider).toBeInTheDocument();
    expect(disabledProvider.closest("[data-disabled]")).not.toBeNull();
  });

  it("uses the selected provider default model instead of inheriting a Claude model id", () => {
    mockGetWorkspaceProviderSettings.mockReturnValue({
      data: { plan: "opencode" },
      isLoading: false,
    });
    mockAgentCatalog.mockReturnValue({
      data: {
        default_provider: "claude_code",
        providers: [
          {
            id: "claude_code",
            label: "Claude Code",
            status: "available",
            models: [{ id: "default", label: "Default" }],
            default_model: "default",
          },
          {
            id: "opencode",
            label: "OpenCode",
            status: "available",
            models: [{ id: "default/default", label: "Default" }],
            default_model: "default/default",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<ModelSelector level="global" />);

    expect(screen.getAllByRole("combobox")[0]).toHaveTextContent("OpenCode / Default");
  });

  it("surfaces live model descriptions from the provider catalog", () => {
    mockAgentCatalog.mockReturnValue({
      data: {
        default_provider: "claude_code",
        providers: [
          {
            id: "claude_code",
            label: "Claude Code",
            status: "available",
            models: [{ id: "default", label: "Default", description: "Opus 4.7 with 1M context" }],
            default_model: "default",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<ModelSelector level="global" />);
    expect(screen.getAllByRole("combobox")[0]).toHaveAttribute("title", "Opus 4.7 with 1M context");
  });

  it("does not render standalone provider actions", async () => {
    const user = userEvent.setup();
    mockAgentCatalog.mockReturnValue({
      data: {
        default_provider: "claude_code",
        providers: [
          {
            id: "claude_code",
            label: "Claude Code",
            status: "available",
            models: [{ id: "default", label: "Default" }],
            default_model: "default",
          },
          {
            id: "opencode",
            label: "OpenCode",
            status: "available",
            models: [{ id: "default/default", label: "Default" }],
            default_model: "default/default",
          },
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<ModelSelector level="global" />);
    await user.click(screen.getAllByRole("combobox")[0]);

    expect(screen.getByText("OpenCode")).toBeInTheDocument();
    expect(screen.queryByText(/Use Claude Code/)).toBeNull();
    expect(screen.queryByText(/Use OpenCode/)).toBeNull();
  });
});
