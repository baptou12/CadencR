import { useCallback, useMemo } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { previewManagedThemePackage, type SignedMixedCatalog } from "@/api/generated";
import { displayVersion, type MarketplaceListing } from "@/lib/marketplace-listings";
import { managedThemeDataSchema, managedThemeDefinition } from "@/lib/theme-marketplace";
import { toThemeDefinition } from "@/lib/themes/user-theme";
import type { ThemeDefinition } from "@/lib/themes";
import type { useThemeMarketplace } from "./useThemeMarketplace";

type ThemeState = ReturnType<typeof useThemeMarketplace>;
type InstalledThemes = ThemeState["inventory"]["data"];
type ThemeIndex = SignedMixedCatalog | null | undefined;

/**
 * A verified preview of one exact catalog version. The key carries the archive
 * digest and the catalog signature, so a changed catalog never shows a stale
 * preview. Fetching downloads and validates the archive without installing
 * it, so it only ever runs on an explicit request (`enabled: false`).
 */
function themePreviewQuery(
  id: string,
  version: string,
  sha256: string | undefined,
  index: ThemeIndex,
) {
  return queryOptions({
    queryKey: ["marketplace", "theme-preview", id, version, sha256, index?.signature.value],
    enabled: false,
    // The key pins the archive digest, so a cached preview can never go stale.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!index) throw new Error("A current signed catalog is required to preview a theme.");
      const response = await previewManagedThemePackage({ theme_id: id, version, index }, signal);
      const parsed = managedThemeDataSchema.parse(response);
      return toThemeDefinition(id, parsed.theme, parsed.assets);
    },
  });
}

function digestOf(listing: MarketplaceListing, version: string): string | undefined {
  return listing.versions.find((entry) => entry.version === version)?.sha256;
}

interface ThemeArt {
  definition: ThemeDefinition | null;
  /** True when the definition is the installed revision rather than a preview. */
  installed: boolean;
  canPreview: boolean;
  isFetching: boolean;
  error: unknown;
  preview: () => void;
}

/** The colors a theme listing can be painted with: installed document, else a requested preview. */
export function useThemeArt(
  installedThemes: InstalledThemes,
  index: ThemeIndex,
  listing: MarketplaceListing,
  version: string | undefined,
): ThemeArt {
  const entry = installedThemes?.find((item) => item.id === listing.id);
  const installedDefinition = useMemo(
    () => (entry?.theme && entry.version === version ? managedThemeDefinition(entry) : null),
    [entry, version],
  );
  const query = useQuery(
    themePreviewQuery(listing.id, version ?? "", version && digestOf(listing, version), index),
  );
  const { refetch } = query;
  const preview = useCallback(() => void refetch(), [refetch]);
  return {
    definition: installedDefinition ?? query.data ?? null,
    installed: !!installedDefinition,
    canPreview: !!index && !!version && listing.inCatalog,
    isFetching: query.isFetching,
    error: query.error,
    preview,
  };
}

/** Request verified previews for several themes at once (one explicit click). */
export function usePreviewThemes(index: ThemeIndex): (listings: MarketplaceListing[]) => void {
  const client = useQueryClient();
  return useCallback(
    (listings) => {
      if (!index) return;
      for (const listing of listings) {
        const version = displayVersion(listing);
        if (!version) continue;
        // `enabled: false` only gates observers; prefetchQuery is the explicit
        // request. It records a failure in the cache instead of throwing, and
        // each tile's own observer renders that error in place.
        void client.prefetchQuery(
          themePreviewQuery(listing.id, version, digestOf(listing, version), index),
        );
      }
    },
    [client, index],
  );
}
