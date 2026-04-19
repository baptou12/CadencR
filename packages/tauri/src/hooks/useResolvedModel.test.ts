import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useResolvedModel } from "./useResolvedModel";

const mockSetModelMutate = vi.fn();
const mockSetProviderMutate = vi.fn();
const mockSetThinkingEffortMutate = vi.fn();

type ModelData = Record<string, string>;
type ProviderData = Record<string, string>;
type KvEntry = { key: string; value: string | null };

const mockFeatureSettings = vi.fn((): { data: ModelData } => ({ data: {} }));
const mockProjectSettings = vi.fn((): { data: ModelData } => ({ data: {} }));
const mockGlobalSettings = vi.fn((): { data: ModelData } => ({ data: {} }));
const mockFeatureProviderSettings = vi.fn((): { data: ProviderData } => ({ data: {} }));
const mockProjectProviderSettings = vi.fn((): { data: ProviderData } => ({ data: {} }));
const mockGlobalProviderSettings = vi.fn((): { data: ProviderData } => ({ data: {} }));
const mockFeatureKvSettings = vi.fn((): { data: KvEntry[] } => ({ data: [] }));
const mockProjectKvSettings = vi.fn((): { data: KvEntry[] } => ({ data: [] }));
const mockWorkspaceKvSettings = vi.fn((): { data: KvEntry[] } => ({ data: [] }));
const mockAgentCatalog = vi.fn(() => ({
  data: {
    default_provider: "claude_code",
    providers: [
      { id: "claude_code", label: "Claude Code", status: "available", models: [], default_model: "default" },
      { id: "opencode", label: "OpenCode", status: "available", models: [], default_model: "default/default" },
    ],
  },
}));

vi.mock("../api/generated", () => ({
  useGetFeatureModelSettings: () => mockFeatureSettings(),
  useGetProjectModelSettings: () => mockProjectSettings(),
  useGetWorkspaceModelSettings: () => mockGlobalSettings(),
  useGetFeatureSettings: () => mockFeatureKvSettings(),
  useGetProjectSettings: () => mockProjectKvSettings(),
  useSetFeatureModelSetting: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockSetModelMutate(data);
      opts?.onSuccess?.();
    },
  })),
  useSetFeatureSetting: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockSetThinkingEffortMutate(data);
      opts?.onSuccess?.();
    },
  })),
  getGetFeatureModelSettingsQueryKey: (id: number) => ["features", "modelSettings", id],
  getGetFeatureSettingsQueryKey: (id: number) => ["features", "settings", id],
}));

vi.mock("@/api/settings", () => ({
  useGetWorkspaceSettings: () => mockWorkspaceKvSettings(),
  settingsArrayToMap: (entries: KvEntry[] | undefined) => Object.fromEntries((entries ?? []).map((entry) => [entry.key, entry.value ?? ""])),
}));

vi.mock("../api/agentRuntime", () => ({
  useAgentCatalog: () => mockAgentCatalog(),
  useGetFeatureProviderSettings: () => mockFeatureProviderSettings(),
  useGetProjectProviderSettings: () => mockProjectProviderSettings(),
  useGetWorkspaceProviderSettings: () => mockGlobalProviderSettings(),
  useSetFeatureProviderSetting: vi.fn(() => ({
    mutate: (data: unknown) => {
      mockSetProviderMutate(data);
    },
  })),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useResolvedModel", () => {
  beforeEach(() => {
    mockSetModelMutate.mockClear();
    mockSetProviderMutate.mockClear();
    mockSetThinkingEffortMutate.mockClear();
    // Default: all empty
    mockFeatureSettings.mockReturnValue({ data: {} });
    mockProjectSettings.mockReturnValue({ data: {} });
    mockGlobalSettings.mockReturnValue({ data: {} });
    mockFeatureProviderSettings.mockReturnValue({ data: {} });
    mockProjectProviderSettings.mockReturnValue({ data: {} });
    mockGlobalProviderSettings.mockReturnValue({ data: {} });
    mockFeatureKvSettings.mockReturnValue({ data: [] });
    mockProjectKvSettings.mockReturnValue({ data: [] });
    mockWorkspaceKvSettings.mockReturnValue({ data: [] });
    mockAgentCatalog.mockReturnValue({
      data: {
        default_provider: "claude_code",
        providers: [
          { id: "claude_code", label: "Claude Code", status: "available", models: [], default_model: "default" },
          { id: "opencode", label: "OpenCode", status: "available", models: [], default_model: "default/default" },
        ],
      },
    });
  });

  it("returns the catalog default model when no settings are configured", () => {
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveProvider("plan")).toBe("claude_code");
    expect(result.current.resolveModel("plan")).toBe("default");
  });

  it("uses feature-level setting when available", () => {
    mockFeatureSettings.mockReturnValue({ data: { plan: "claude-feature-model" } });
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveModel("plan")).toBe("claude-feature-model");
  });

  it("falls back to project-level setting when feature setting absent", () => {
    mockFeatureSettings.mockReturnValue({ data: {} });
    mockProjectSettings.mockReturnValue({ data: { plan: "claude-project-model" } });
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveModel("plan")).toBe("claude-project-model");
  });

  it("falls back to global setting when feature and project absent", () => {
    mockFeatureSettings.mockReturnValue({ data: {} });
    mockProjectSettings.mockReturnValue({ data: {} });
    mockGlobalSettings.mockReturnValue({ data: { plan: "claude-global-model" } });
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveModel("plan")).toBe("claude-global-model");
  });

  it("feature setting takes precedence over project and global", () => {
    mockFeatureSettings.mockReturnValue({ data: { plan: "feature-model" } });
    mockProjectSettings.mockReturnValue({ data: { plan: "project-model" } });
    mockGlobalSettings.mockReturnValue({ data: { plan: "global-model" } });
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveModel("plan")).toBe("feature-model");
  });

  it("handleModelChange calls setModelMutation.mutate", () => {
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    result.current.handleModelChange("execute", "claude-3-5-sonnet");
    expect(mockSetModelMutate).toHaveBeenCalledWith({
      featureId: 1,
      modelType: "execute",
      model: "claude-3-5-sonnet",
    });
  });

  it("resolves different models for different agent types", () => {
    mockFeatureSettings.mockReturnValue({
      data: { plan: "plan-model", execute: "execute-model" },
    });
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveModel("plan")).toBe("plan-model");
    expect(result.current.resolveModel("execute")).toBe("execute-model");
  });

  it("uses the new provider default when a nearer provider override changes providers", () => {
    mockGlobalSettings.mockReturnValue({ data: { plan: "opus" } });
    mockFeatureProviderSettings.mockReturnValue({ data: { plan: "opencode" } });

    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveProvider("plan")).toBe("opencode");
    expect(result.current.resolveModel("plan")).toBe("default/default");
  });

  it("keeps the inherited model when the provider does not change", () => {
    mockProjectProviderSettings.mockReturnValue({ data: { plan: "claude_code" } });
    mockGlobalSettings.mockReturnValue({ data: { plan: "default" } });

    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    expect(result.current.resolveModel("plan")).toBe("default");
  });

  it("handleProviderChange calls setProviderMutation.mutate", () => {
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    result.current.handleProviderChange("plan", "opencode");
    expect(mockSetProviderMutate).toHaveBeenCalledWith({
      featureId: 1,
      providerType: "plan",
      provider: "opencode",
    });
  });
});
