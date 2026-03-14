import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useResolvedModel } from "./useResolvedModel";

const mockSetModelMutate = vi.fn();

type ModelData = Record<string, string>;

const mockFeatureSettings = vi.fn((): { data: ModelData } => ({ data: {} }));
const mockProjectSettings = vi.fn((): { data: ModelData } => ({ data: {} }));
const mockGlobalSettings = vi.fn((): { data: ModelData } => ({ data: {} }));

vi.mock("../api/generated", () => ({
  useGetFeatureModelSettings: () => mockFeatureSettings(),
  useGetProjectModelSettings: () => mockProjectSettings(),
  useGetWorkspaceModelSettings: () => mockGlobalSettings(),
  useSetFeatureModelSetting: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockSetModelMutate(data);
      opts?.onSuccess?.();
    },
  })),
  getGetFeatureModelSettingsQueryKey: (id: number) => ["features", "modelSettings", id],
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useResolvedModel", () => {
  beforeEach(() => {
    mockSetModelMutate.mockClear();
    // Default: all empty
    mockFeatureSettings.mockReturnValue({ data: {} });
    mockProjectSettings.mockReturnValue({ data: {} });
    mockGlobalSettings.mockReturnValue({ data: {} });
  });

  it("returns DEFAULT_MODEL when no settings are configured", () => {
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    const model = result.current.resolveModel("plan");
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
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

  it("resolveModel handles empty settings data gracefully", () => {
    mockFeatureSettings.mockReturnValue({ data: {} });
    mockProjectSettings.mockReturnValue({ data: {} });
    mockGlobalSettings.mockReturnValue({ data: {} });
    const { result } = renderHook(() => useResolvedModel(1, 1), { wrapper });
    // Should fall through to DEFAULT_MODEL without throwing
    expect(() => result.current.resolveModel("plan")).not.toThrow();
    const model = result.current.resolveModel("plan");
    expect(typeof model).toBe("string");
  });
});
