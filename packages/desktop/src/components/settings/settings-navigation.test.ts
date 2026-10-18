import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/marketplace-gate", () => ({
  get MARKETPLACE_ENABLED() {
    return gate.enabled;
  },
}));
import { isLegacyMarketplaceLink, parseSettingsSearch } from "./settings-navigation";
import { NAV_GROUPS } from "./settings-nav-groups";

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

  it("keeps the Custom tabs create action and drops unknown actions", () => {
    expect(parseSettingsSearch({ section: "custom-tabs", action: "create" })).toEqual({
      section: "custom-tabs",
      action: "create",
    });
    expect(parseSettingsSearch({ action: "delete" }).action).toBeUndefined();
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id))).toContain(
      "custom-tabs",
    );
  });

  it("does not offer Marketplace as a general scrolling section", () => {
    const sections = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(sections).not.toContain("marketplace");
    expect(sections).toContain("appearance");
    expect(sections).toContain("providers");
  });
});
