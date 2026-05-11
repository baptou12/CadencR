import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAgentSessionModelState } from "./useAgentSessionModelState";
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
});
