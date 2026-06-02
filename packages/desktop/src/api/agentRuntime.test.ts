import { renderHook, act } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestQueryClient } from "@/test-utils";
import {
  useSetActiveClaudeCodeProfile,
  useUpsertClaudeCodeProfile,
  useDeleteClaudeCodeProfile,
} from "./agentRuntime";

const mockCustomInstance = vi.fn();
vi.mock("./client", () => ({
  customInstance: (...args: unknown[]) => mockCustomInstance(...args),
}));

function renderWithSpiedClient<T>(useHook: () => T) {
  const queryClient = createTestQueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(useHook, { wrapper });
  return { result, invalidateSpy };
}

describe("Claude Code profile mutations", () => {
  beforeEach(() => {
    mockCustomInstance.mockReset();
    mockCustomInstance.mockResolvedValue({ ok: true });
  });

  // The active profile env feeds the model probe, so switching profiles must
  // refetch the catalog — otherwise the picker keeps the old profile's models
  // (under Bedrock/Vertex even the model ids differ). Regression for issue #43.
  it("invalidates both profiles and the agent catalog when activating a profile", async () => {
    const { result, invalidateSpy } = renderWithSpiedClient(() => useSetActiveClaudeCodeProfile());
    await act(async () => {
      await result.current.mutateAsync({ name: "bedrock" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["claude-code", "profiles"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-catalog"] });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidates both profiles and the agent catalog when upserting a profile", async () => {
    mockCustomInstance.mockResolvedValue({ name: "bedrock", env: {} });
    const { result, invalidateSpy } = renderWithSpiedClient(() => useUpsertClaudeCodeProfile());
    await act(async () => {
      await result.current.mutateAsync({ name: "bedrock", env: { CLAUDE_CODE_USE_BEDROCK: "1" } });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["claude-code", "profiles"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-catalog"] });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("invalidates both profiles and the agent catalog when deleting a profile", async () => {
    const { result, invalidateSpy } = renderWithSpiedClient(() => useDeleteClaudeCodeProfile());
    await act(async () => {
      await result.current.mutateAsync({ name: "bedrock" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["claude-code", "profiles"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-catalog"] });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
