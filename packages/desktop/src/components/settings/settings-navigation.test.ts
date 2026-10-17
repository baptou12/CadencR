import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/marketplace-gate", () => ({
  get MARKETPLACE_ENABLED() {
    return gate.enabled;
  },
}));
import { isLegacyMarketplaceLink, parseSettingsSearch } from "./settings-navigation";

afterEach(() => {
  gate.enabled = true;
});

describe("settings navigation", () => {
  it("preserves general section deep links", () => {
    expect(parseSettingsSearch({ section: "appearance" })).toEqual({ section: "appearance" });
    expect(isLegacyMarketplaceLink(parseSettingsSearch({ section: "appearance" }))).toBe(false);
  });

  it("sends old marketplace tab and section links to the Marketplace page", () => {
    expect(isLegacyMarketplaceLink(parseSettingsSearch({ tab: "marketplace" }))).toBe(true);
    expect(isLegacyMarketplaceLink(parseSettingsSearch({ section: "marketplace" }))).toBe(true);
  });

  it("keeps marketplace links on Settings when the marketplace is not in the build", () => {
    gate.enabled = false;
    expect(isLegacyMarketplaceLink(parseSettingsSearch({ tab: "marketplace" }))).toBe(false);
  });

  it("validates unknown URL input without rejecting the page", () => {
    expect(parseSettingsSearch({ tab: 3, section: 42 })).toEqual({
      tab: undefined,
      section: undefined,
    });
  });
});
