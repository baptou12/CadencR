import { describe, expect, it } from "vitest";
import { resolveModelAlias, type CatalogModelLike } from "./models";

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
    expect(resolveModelAlias("sonnet", bedrockCatalog)).toBe("us.anthropic.claude-sonnet-4-6");
  });

  it("maps the [1m] alias to the concrete 1M id", () => {
    expect(resolveModelAlias("sonnet[1m]", bedrockCatalog)).toBe(
      "us.anthropic.claude-sonnet-4-6[1m]",
    );
  });

  it("maps opus to the primary row, not a legacy one", () => {
    expect(resolveModelAlias("opus", bedrockCatalog)).toBe("us.anthropic.claude-opus-4-8");
  });

  it("keeps an id that already exists in the catalog", () => {
    expect(resolveModelAlias("haiku", bedrockCatalog)).toBe("haiku");
    expect(resolveModelAlias("us.anthropic.claude-opus-4-7", bedrockCatalog)).toBe(
      "us.anthropic.claude-opus-4-7",
    );
  });

  it("is a no-op when the backend exposes aliases directly (Anthropic)", () => {
    const anthropic: CatalogModelLike[] = [
      { id: "default", label: "Default (recommended)" },
      { id: "sonnet", label: "Sonnet" },
      { id: "haiku", label: "Haiku" },
    ];
    expect(resolveModelAlias("sonnet", anthropic)).toBe("sonnet");
  });

  it("leaves unknown / custom ids untouched", () => {
    expect(resolveModelAlias("my-gateway/custom", bedrockCatalog)).toBe("my-gateway/custom");
  });

  it("leaves an alias untouched when no matching family label is present", () => {
    expect(
      resolveModelAlias("sonnet", [{ id: "us.anthropic.claude-opus-4-8", label: "Opus" }]),
    ).toBe("sonnet");
  });
});
