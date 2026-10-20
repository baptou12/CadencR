import { describe, expect, it } from "vitest";
import { signedMixedCatalogSchema } from "./theme-marketplace";
import { catalogSchema } from "./marketplace";

const tab = {
  kind: "tab",
  package: {
    tab: {
      id: "files-graph",
      name: "Files graph",
      description: "Explore changes",
      version: "1.0.0",
      repository: "https://github.com/acme/tabs",
      license: "MIT",
      api_version: 1,
      distribution: {
        archive: "https://github.com/acme/tabs/releases/download/v1.0.0/tab.tar.gz",
        sha256: "a".repeat(64),
      },
    },
    host: { publisher: "acme", compatibility: { min_app_version: "0.13.1" } },
  },
};

function envelope(entry: unknown = tab) {
  return {
    signature: { algorithm: "ed25519", key_id: "registry", value: "signature" },
    signed: {
      schema_version: 2,
      generated_at: "2026-10-17T00:00:00Z",
      expires_at: "2026-10-18T00:00:00Z",
      packages: [entry],
    },
  };
}

describe("custom tabs in the signed marketplace catalog", () => {
  it("accepts tab entries without changing the signed payload", () => {
    const index = envelope();
    expect(signedMixedCatalogSchema.parse(index)).toEqual(index);
    expect(
      catalogSchema.parse({
        source_configured: true,
        cache_status: "verified",
        refreshed: false,
        used_cached_verified_catalog: false,
        index,
      }).index,
    ).toEqual(index);
  });

  it("rejects unknown archive launch fields and unsupported API versions", () => {
    const invalid = structuredClone(tab);
    invalid.package.tab.api_version = 2;
    expect(signedMixedCatalogSchema.safeParse(envelope(invalid)).success).toBe(false);
    expect(
      signedMixedCatalogSchema.safeParse(
        envelope({
          ...tab,
          package: {
            ...tab.package,
            tab: {
              ...tab.package.tab,
              distribution: { ...tab.package.tab.distribution, cmd: "run" },
            },
          },
        }),
      ).success,
    ).toBe(false);
  });
});
