import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  MODEL_CATALOG_LOADING_LABEL,
  useAgentSessionModelState,
} from "./useAgentSessionModelState";
import type { AgentCatalog } from "@/api/agentRuntime";

const catalog: AgentCatalog = {
  default_provider: "claude_code",
  providers: [
    {
      id: "claude_code",
      label: "Claude",
      status: "available",
      default_model: "opus",
      models: [{ id: "opus", label: "Opus" }],
    },
  ],
};

describe("useAgentSessionModelState.canChangeProvider", () => {
  it("shows a loading label instead of a fallback model before catalog data arrives", () => {
    const { result } = renderHook(() =>
      useAgentSessionModelState({
        agentCatalog: undefined,
        currentProviderId: "opencode",
        currentModelId: "default/default",
        onProviderChange: () => {},
        hasConversation: false,
      }),
    );
    expect(result.current.currentModelLabel).toBe(MODEL_CATALOG_LOADING_LABEL);
    expect(result.current.isCatalogLoading).toBe(true);
    expect(result.current.visibleModels).toEqual([]);
  });

  it("allows provider change on a fresh conversation", () => {
    const { result } = renderHook(() =>
      useAgentSessionModelState({
        agentCatalog: catalog,
        currentProviderId: "claude_code",
        currentModelId: "opus",
        onProviderChange: () => {},
        hasConversation: false,
      }),
    );
    expect(result.current.canChangeProvider).toBe(true);
  });

  it("locks the provider once the conversation has any block", () => {
    const { result } = renderHook(() =>
      useAgentSessionModelState({
        agentCatalog: catalog,
        currentProviderId: "claude_code",
        currentModelId: "opus",
        onProviderChange: () => {},
        hasConversation: true,
      }),
    );
    expect(result.current.canChangeProvider).toBe(false);
  });

  it("stays locked when no onProviderChange handler is wired", () => {
    const { result } = renderHook(() =>
      useAgentSessionModelState({
        agentCatalog: catalog,
        currentProviderId: "claude_code",
        currentModelId: "opus",
        hasConversation: false,
      }),
    );
    expect(result.current.canChangeProvider).toBe(false);
  });

  it("ignores stale providers that are no longer selectable", () => {
    const { result } = renderHook(() =>
      useAgentSessionModelState({
        agentCatalog: catalog,
        currentProviderId: "opencode",
        runtimeProvider: "claude_code",
        hasConversation: false,
      }),
    );
    expect(result.current.activeProviderId).toBe("claude_code");
    expect(result.current.visibleModels).toEqual([{ id: "opus", label: "Opus" }]);
  });

  it("falls back to the catalog default when runtime provider is stale", () => {
    const { result } = renderHook(() =>
      useAgentSessionModelState({
        agentCatalog: catalog,
        runtimeProvider: "opencode",
        hasConversation: false,
      }),
    );
    expect(result.current.activeProviderId).toBe("claude_code");
  });
});
