import { describe, expect, it } from "vitest";
import type {
  ManagedCatalogResponse,
  ManagedProviderInventoryEntry,
  ManagedThemeCatalogResponse,
} from "@/api/generated";
import {
  buildListings,
  compareVersions,
  displayVersion,
  matchesListing,
  offeredVersion,
  providerDates,
  spotlightListings,
} from "./marketplace-listings";
import { sidebarFilterTerms } from "./sidebar-filter";

const sha = "a".repeat(64);
const themeEntry = (id: string, version: string) => ({
  kind: "theme" as const,
  package: {
    theme: {
      id,
      name: id[0].toUpperCase() + id.slice(1),
      description: `${id} theme`,
      version,
      repository: "https://github.com/cadencr/themes",
      license: "Apache-2.0",
      document_version: 1 as const,
      distribution: { archive: `https://github.com/cadencr/themes/${id}.tar.gz`, sha256: sha },
    },
    host: { publisher: "Cadencr", compatibility: { min_app_version: "0.13.0" } },
  },
});
const providerEntry = (id: string, version: string) => ({
  kind: "provider" as const,
  package: {
    agent: {
      id,
      name: id.toUpperCase(),
      version,
      description: `${id} agent`,
      distribution: { binary: { "darwin-aarch64": { archive: "https://x/a.tgz", cmd: "bin/a" } } },
    },
    host: {
      publisher: "Pub",
      compatibility: { min_app_version: "0.12.0" },
      assets: { icon: "icon.svg" },
    },
  },
});
const index = {
  signature: { algorithm: "ed25519" as const, key_id: "k", value: "v" },
  signed: {
    schema_version: 2 as const,
    generated_at: "2026-10-01T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    packages: [
      themeEntry("graphite", "0.1.0"),
      themeEntry("graphite", "0.2.0"),
      themeEntry("ember", "0.1.0"),
      providerEntry("pi", "0.3.0"),
      providerEntry("pi", "0.10.0"),
    ],
  },
};
const providerCatalog = {
  source_configured: true,
  cache_status: "verified",
  refreshed: true,
  used_cached_verified_catalog: false,
  recommended_versions: { pi: "0.10.0" },
  index,
} as ManagedCatalogResponse;
const themeCatalog = {
  verified: true,
  recommended_versions: { graphite: "0.2.0", ember: "0.1.0" },
  index,
} as ManagedThemeCatalogResponse;
const pi: ManagedProviderInventoryEntry = {
  id: "pi",
  version: "0.3.0",
  digest: "d",
  active_now: true,
  active_after_restart: true,
  enabled_after_restart: true,
  restart_required: false,
  history: [
    { action: "installed", sequence: 1, occurred_at: "2026-09-01T00:00:00Z", version: "0.2.0" },
    { action: "disabled", sequence: 3, occurred_at: "2026-09-20T00:00:00Z", version: "0.3.0" },
    { action: "updated", sequence: 2, occurred_at: "2026-09-10T00:00:00Z", version: "0.3.0" },
  ],
  quarantine: [],
};

describe("compareVersions", () => {
  it("orders numerically and ranks a prerelease below its release", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-beta.10", "1.0.0-beta.2")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("refuses to order what does not parse, so no update is ever claimed", () => {
    expect(compareVersions("latest", "1.0.0")).toBeNull();
  });
});

describe("buildListings", () => {
  const listings = buildListings({
    providerCatalog,
    providerInventory: [pi],
    themeCatalog,
    themeInventory: [
      {
        id: "graphite",
        name: "Graphite",
        version: "0.2.0",
        sha256: sha,
        active: true,
        theme: null,
        error: "Archive unreadable",
      },
    ],
    displayedThemeId: "cadencr-dark",
  });
  const byKey = new Map(listings.map((listing) => [listing.key, listing]));

  it("lists every kind once, sorted by name, with versions newest first", () => {
    expect(listings.map((listing) => listing.key)).toEqual([
      "theme:ember",
      "theme:graphite",
      "provider:pi",
    ]);
    expect(byKey.get("provider:pi")?.versions.map((v) => v.version)).toEqual(["0.10.0", "0.3.0"]);
    expect(byKey.get("provider:pi")?.versions[0].platforms).toEqual(["darwin-aarch64"]);
    expect(byKey.get("theme:graphite")?.contributes).toEqual(["theme"]);
  });

  it("flags an update only when the host recommendation is newer than the installed revision", () => {
    expect(byKey.get("provider:pi")?.update).toBe("0.10.0");
    expect(byKey.get("theme:graphite")?.update).toBeUndefined();
    expect(byKey.get("theme:ember")?.update).toBeUndefined();
  });

  it("separates the theme on screen from a saved slot reference, and keeps errors", () => {
    const graphite = byKey.get("theme:graphite")?.installed;
    expect(graphite).toMatchObject({ active: false, selected: true, error: "Archive unreadable" });
  });

  it("dates installs and changes from confirmed history in sequence order", () => {
    expect(providerDates(pi)).toEqual({
      installedAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-10T00:00:00Z",
    });
  });

  it("keeps an installed plugin the catalog no longer lists, and drops failed installs", () => {
    const orphan = buildListings({
      providerInventory: [
        { ...pi, id: "gone" },
        { ...pi, id: "failed", version: null, digest: null },
      ],
    });
    expect(orphan.map((listing) => [listing.id, listing.inCatalog, listing.name])).toEqual([
      ["gone", false, "gone"],
    ]);
  });

  it("leads the showcase with updates, then what is not installed, never installed-and-current", () => {
    expect(spotlightListings(listings).map((listing) => listing.key)).toEqual([
      "provider:pi",
      "theme:ember",
    ]);
  });

  it("searches name, id, description, publisher and kind, every term required", () => {
    const ember = byKey.get("theme:ember")!;
    expect(matchesListing(ember, sidebarFilterTerms("CADENCR"))).toBe(true);
    expect(matchesListing(ember, sidebarFilterTerms("ember theme"))).toBe(true);
    expect(matchesListing(ember, sidebarFilterTerms("ember provider"))).toBe(false);
  });

  it("names the version a listing stands for and the one a detail page offers", () => {
    const pi = byKey.get("provider:pi")!;
    expect(displayVersion(pi)).toBe("0.3.0");
    expect(offeredVersion(pi)).toBe("0.10.0");
    expect(displayVersion(byKey.get("theme:ember")!)).toBe("0.1.0");
  });

  it("marks an installed theme without a valid document as unusable", () => {
    expect(byKey.get("theme:graphite")?.installed?.usable).toBe(false);
  });
});
