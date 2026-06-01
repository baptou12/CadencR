import { describe, expect, it } from "vitest";
import {
  resolveClaudeModelAlias,
  resolveProviderModelAlias,
  type CatalogModelLike,
} from "./provider-model-aliases";

// Catalog the CLI returns under a Bedrock profile: concrete ids with canonical
// family labels, plus the `haiku`/`default` aliases it still exposes verbatim.
const bedrockCatalog: CatalogModelLike[] = [
  { id: "default", label: "Default" },
  { id: "us.anthropic.claude-sonnet-4-6", label: "Sonnet" },
  { id: "us.anthropic.claude-sonnet-4-6[1m]", label: "Sonnet (1M context)" },
  { id: "us.anthropic.claude-opus-4-8", label: "Opus" },
  { id: "us.anthropic.claude-opus-4-7", label: "Opus 4.7" },
  { id: "haiku", label: "Haiku" },
];

describe("resolveModelAlias", () => {
  it("maps a bare sonnet alias to the concrete Bedrock id", () => {
    expect(resolveClaudeModelAlias("sonnet", bedrockCatalog)).toBe(
      "us.anthropic.claude-sonnet-4-6",
    );
  });

  it("maps the [1m] alias to the concrete 1M id", () => {
    expect(resolveClaudeModelAlias("sonnet[1m]", bedrockCatalog)).toBe(
      "us.anthropic.claude-sonnet-4-6[1m]",
    );
  });

  it("maps opus to the primary row, not a legacy one", () => {
    expect(resolveClaudeModelAlias("opus", bedrockCatalog)).toBe("us.anthropic.claude-opus-4-8");
  });

  it("maps aliases case-insensitively", () => {
    expect(resolveClaudeModelAlias("Sonnet", bedrockCatalog)).toBe(
      "us.anthropic.claude-sonnet-4-6",
    );
    expect(resolveClaudeModelAlias("SONNET[1M]", bedrockCatalog)).toBe(
      "us.anthropic.claude-sonnet-4-6[1m]",
    );
  });

  it("keeps an id that already exists in the catalog", () => {
    expect(resolveClaudeModelAlias("haiku", bedrockCatalog)).toBe("haiku");
    expect(resolveClaudeModelAlias("us.anthropic.claude-opus-4-7", bedrockCatalog)).toBe(
      "us.anthropic.claude-opus-4-7",
    );
  });

  it("is a no-op when the backend exposes aliases directly (Anthropic)", () => {
    const anthropic: CatalogModelLike[] = [
      { id: "default", label: "Default (recommended)" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ];
    expect(resolveClaudeModelAlias("sonnet", anthropic)).toBe("sonnet");
  });

  it("leaves unknown / custom ids untouched", () => {
    expect(resolveClaudeModelAlias("my-gateway/custom", bedrockCatalog)).toBe("my-gateway/custom");
  });

  it("leaves an alias untouched when no matching family label is present", () => {
    expect(
      resolveClaudeModelAlias("sonnet", [{ id: "us.anthropic.claude-opus-4-8", label: "Opus" }]),
    ).toBe("sonnet");
  });

  it("only applies Claude alias resolution to the Claude Code provider", () => {
    expect(resolveProviderModelAlias("claude_code", "sonnet", bedrockCatalog)).toBe(
      "us.anthropic.claude-sonnet-4-6",
    );
    expect(resolveProviderModelAlias("opencode", "sonnet", bedrockCatalog)).toBe("sonnet");
  });
});
