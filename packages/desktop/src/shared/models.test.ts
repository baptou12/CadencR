import { describe, expect, it } from "vitest";
import { resolveRuntimeSelection, type CatalogProviderLike } from "./models";

const PROVIDERS: CatalogProviderLike[] = [
  { id: "codex_cli", default_model: "gpt-5.4" },
  { id: "opencode", default_model: "openai/gpt-5.4" },
];

describe("resolveRuntimeSelection", () => {
  it("ignores saved providers that are absent from the available catalog", () => {
    const selection = resolveRuntimeSelection({
      agentType: "session",
      providers: PROVIDERS,
      defaultProviderId: "codex_cli",
      globalProviders: { session: "claude_code" },
    });

    expect(selection).toEqual({ providerId: "codex_cli", modelId: "gpt-5.4" });
  });

  it("resets the model when an unavailable scoped provider override is ignored", () => {
    const selection = resolveRuntimeSelection({
      agentType: "session",
      providers: PROVIDERS,
      defaultProviderId: "codex_cli",
      projectProviders: { session: "claude_code" },
      projectModels: { session: "opus" },
    });

    expect(selection).toEqual({ providerId: "codex_cli", modelId: "gpt-5.4" });
  });

  it("resets the global model when an unavailable global provider is ignored", () => {
    const selection = resolveRuntimeSelection({
      agentType: "session",
      providers: PROVIDERS,
      defaultProviderId: "codex_cli",
      globalProviders: { session: "claude_code" },
      globalModels: { session: "opus" },
    });

    expect(selection).toEqual({ providerId: "codex_cli", modelId: "gpt-5.4" });
  });

  it("ignores providers marked unavailable even when they are present in the catalog", () => {
    const selection = resolveRuntimeSelection({
      agentType: "session",
      providers: [
        { id: "claude_code", status: "unavailable", default_model: "opus" },
        ...PROVIDERS,
      ],
      defaultProviderId: "claude_code",
    });

    expect(selection).toEqual({ providerId: "codex_cli", modelId: "gpt-5.4" });
  });
});
