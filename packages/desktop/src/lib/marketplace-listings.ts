import type {
  ManagedCatalogResponse,
  ManagedProviderInventoryEntry,
  ManagedProviderPackage,
  ManagedThemeCatalogResponse,
} from "@/api/generated";
import type { z } from "zod";
import { groupPackages, installedRevision, providerCatalogPackages } from "./marketplace";
import { matchesSidebarFilter } from "./sidebar-filter";
import {
  groupThemePackages,
  type managedThemeEntrySchema,
  type ThemeMarketplacePackage,
} from "./theme-marketplace";

/** What a marketplace package adds to Cadencr — the kinds the signed catalog serves today. */
export const PLUGIN_KINDS = ["theme", "provider"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];
type ManagedThemeEntry = z.infer<typeof managedThemeEntrySchema>;

export function isPluginKind(value: string): value is PluginKind {
  return (PLUGIN_KINDS as readonly string[]).includes(value);
}

interface ListingVersion {
  version: string;
  minApp: string;
  maxApp?: string | null;
  /** Provider binary targets (`darwin-aarch64`, …); empty for themes. */
  platforms: string[];
  /** Theme archive digest — keys verified previews to this exact archive. */
  sha256?: string;
}

interface InstalledState {
  version: string | null;
  /** Provider: running now. Theme: the theme on screen right now. */
  active: boolean;
  /** Theme: the installed document validated and can be applied. Provider: always. */
  usable: boolean;
  /** Provider only: whether it starts with the next launch. */
  enabled?: boolean;
  /** Theme only: a saved light/dark/manual selection references it. */
  selected?: boolean;
  restartRequired: boolean;
  error?: string | null;
  installedAt?: string;
  updatedAt?: string;
}

export interface MarketplaceListing {
  /** `${kind}:${id}` — unique across kinds. */
  key: string;
  kind: PluginKind;
  /**
   * Every kind installing this package contributes. One package is one kind in
   * the signed catalog today; the list is what the UI renders so a future
   * multi-contribution package needs no new layout.
   */
  contributes: PluginKind[];
  id: string;
  name: string;
  description: string;
  publisher?: string;
  license?: string;
  repository?: string;
  website?: string;
  authors: string[];
  /** Catalog versions, newest first by version order. */
  versions: ListingVersion[];
  /** Host-computed compatible recommendation (never derived here). */
  recommended?: string;
  installed?: InstalledState;
  /** The recommended version when it is newer than the installed one. */
  update?: string;
  inCatalog: boolean;
}

/** The version a listing currently stands for: installed, else the one on offer. */
export function displayVersion(listing: MarketplaceListing): string | undefined {
  return listing.installed?.version ?? listing.recommended ?? listing.versions[0]?.version;
}

/** The version a detail page offers first: a pending update wins over what is installed. */
export function offeredVersion(listing: MarketplaceListing): string {
  return listing.update ?? listing.installed?.version ?? listing.recommended ?? "";
}

type ParsedVersion = { core: number[]; pre?: string } | null;

function parseVersion(value: string): ParsedVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(value.trim());
  return match
    ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] }
    : null;
}

function compareParsed(left: ParsedVersion, right: ParsedVersion): number | null {
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, undefined, { numeric: true });
}

/** Semver-ish ordering; `null` when either side does not parse, so no update is claimed. */
export function compareVersions(a: string, b: string): number | null {
  return compareParsed(parseVersion(a), parseVersion(b));
}

function sortVersions(versions: ListingVersion[]): ListingVersion[] {
  return versions
    .map((entry) => ({ entry, parsed: parseVersion(entry.version) }))
    .sort((a, b) => compareParsed(b.parsed, a.parsed) ?? 0)
    .map(({ entry }) => entry);
}

function updateFor(recommended?: string, installed?: string | null): string | undefined {
  if (!recommended || !installed) return undefined;
  return (compareVersions(recommended, installed) ?? 0) > 0 ? recommended : undefined;
}

/** Install and last-change dates, read from the confirmed history (newest event wins). */
export function providerDates(entry: ManagedProviderInventoryEntry): {
  installedAt?: string;
  updatedAt?: string;
} {
  const history = [...entry.history].sort((a, b) => a.sequence - b.sequence);
  const installed = history.filter((event) => event.action === "installed").at(-1);
  const changed = history
    .filter((event) => ["installed", "updated", "rolled_back"].includes(event.action))
    .at(-1);
  return { installedAt: installed?.occurred_at, updatedAt: changed?.occurred_at };
}

function providerInstalled(entry: ManagedProviderInventoryEntry): InstalledState | undefined {
  if (!installedRevision(entry)) return undefined;
  return {
    version: entry.version ?? null,
    active: entry.active_now,
    usable: true,
    enabled: entry.enabled_after_restart,
    restartRequired: entry.restart_required,
    error: entry.error,
    ...providerDates(entry),
  };
}

function themeInstalled(entry: ManagedThemeEntry, displayedThemeId?: string): InstalledState {
  return {
    version: entry.version,
    active: displayedThemeId === `managed:${entry.id}`,
    usable: !!entry.theme,
    selected: entry.active,
    restartRequired: false,
    error: entry.error,
  };
}

/** The metadata of the recommended version, else the newest one listed. */
function pickMeta<T>(
  versions: T[] | undefined,
  version: (item: T) => string,
  recommended?: string,
) {
  return versions?.find((item) => version(item) === recommended) ?? versions?.at(-1);
}

function baseListing(
  kind: PluginKind,
  id: string,
  versions: ListingVersion[],
  recommended: string | undefined,
  installed: InstalledState | undefined,
) {
  return {
    key: `${kind}:${id}`,
    kind,
    contributes: [kind],
    id,
    versions: sortVersions(versions),
    recommended,
    installed,
    update: updateFor(recommended, installed?.version),
    inCatalog: versions.length > 0,
  };
}

function providerListing(
  id: string,
  versions: ManagedProviderPackage[] = [],
  entry: ManagedProviderInventoryEntry | undefined,
  recommended: string | undefined,
): MarketplaceListing {
  const meta = pickMeta(versions, (item) => item.agent.version, recommended);
  return {
    ...baseListing(
      "provider",
      id,
      versions.map((item) => ({
        version: item.agent.version,
        minApp: item.host.compatibility.min_app_version,
        maxApp: item.host.compatibility.max_app_version,
        platforms: Object.keys(item.agent.distribution?.binary ?? {}),
      })),
      recommended,
      entry && providerInstalled(entry),
    ),
    name: meta?.agent.name ?? id,
    description: meta?.agent.description ?? "",
    publisher: meta?.host.publisher,
    license: meta?.agent.license,
    repository: meta?.agent.repository,
    website: meta?.agent.website,
    authors: meta?.agent.authors ?? [],
  };
}

function themeListing(
  id: string,
  versions: ThemeMarketplacePackage[] = [],
  entry: ManagedThemeEntry | undefined,
  recommended: string | undefined,
  displayedThemeId: string | undefined,
): MarketplaceListing {
  const meta = pickMeta(versions, (item) => item.theme.version, recommended);
  return {
    ...baseListing(
      "theme",
      id,
      versions.map((item) => ({
        version: item.theme.version,
        minApp: item.host.compatibility.min_app_version,
        maxApp: item.host.compatibility.max_app_version,
        platforms: [],
        sha256: item.theme.distribution.sha256,
      })),
      recommended,
      entry && themeInstalled(entry, displayedThemeId),
    ),
    name: meta?.theme.name ?? entry?.name ?? id,
    description: meta?.theme.description ?? "",
    publisher: meta?.host.publisher,
    license: meta?.theme.license,
    repository: meta?.theme.repository,
    authors: [],
  };
}

interface ListingSources {
  providerCatalog?: ManagedCatalogResponse;
  providerInventory?: ManagedProviderInventoryEntry[];
  themeCatalog?: ManagedThemeCatalogResponse;
  themeInventory?: ManagedThemeEntry[];
  displayedThemeId?: string;
}

/** One list across kinds: every catalog package plus anything installed but no longer listed. */
export function buildListings(sources: ListingSources): MarketplaceListing[] {
  const providerGroups = new Map(
    groupPackages(providerCatalogPackages(sources.providerCatalog?.index)).map((group) => [
      group[0].agent.id,
      group,
    ]),
  );
  const providerEntries = new Map((sources.providerInventory ?? []).map((e) => [e.id, e]));
  const themeGroups = new Map(
    groupThemePackages(sources.themeCatalog).map((group) => [group[0].theme.id, group]),
  );
  const themeEntries = new Map((sources.themeInventory ?? []).map((e) => [e.id, e]));
  const providerIds = new Set([...providerGroups.keys(), ...providerEntries.keys()]);
  const themeIds = new Set([...themeGroups.keys(), ...themeEntries.keys()]);
  const listings = [
    ...[...providerIds].map((id) =>
      providerListing(
        id,
        providerGroups.get(id),
        providerEntries.get(id),
        sources.providerCatalog?.recommended_versions?.[id],
      ),
    ),
    ...[...themeIds].map((id) =>
      themeListing(
        id,
        themeGroups.get(id),
        themeEntries.get(id),
        sources.themeCatalog?.recommended_versions[id],
        sources.displayedThemeId,
      ),
    ),
  ];
  // A provider inventory row without a revision is a failed install, not an installation.
  return listings
    .filter((listing) => listing.inCatalog || listing.installed)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What the showcase leads with, honestly ordered: pending updates, then what
 * the user has not installed yet. Never an invented "featured" pick.
 */
export function spotlightListings(listings: MarketplaceListing[], limit = 5): MarketplaceListing[] {
  const updates = listings.filter((listing) => listing.update);
  const fresh = listings.filter((listing) => listing.inCatalog && !listing.installed);
  return [...updates, ...fresh].slice(0, limit);
}

/** Every search term must appear in the name, id, description, publisher or kind. */
export function matchesListing(listing: MarketplaceListing, terms: readonly string[]): boolean {
  return matchesSidebarFilter(terms, [
    listing.name,
    listing.id,
    listing.description,
    listing.publisher,
    listing.kind,
  ]);
}
