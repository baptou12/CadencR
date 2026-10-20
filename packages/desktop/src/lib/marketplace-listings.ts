import type {
  ManagedCatalogResponse,
  ManagedProviderInventoryEntry,
  ManagedProviderPackage,
  ManagedThemeCatalogResponse,
  ManagedTabInventoryEntry,
  PluginTabSummary,
  TabVersionUnavailable,
} from "@/api/generated";
import {
  groupTabPackages,
  runtimeNativeCode,
  tabNativeCode,
  type TabMarketplacePackage,
  type TabNativeCode,
} from "./marketplace-tab-package";
import { z } from "zod";
import { groupPackages, installedRevision, providerCatalogPackages } from "./marketplace";
import { matchesSidebarFilter } from "./sidebar-filter";
import { compareVersions, sortVersions } from "./marketplace-versions";
import {
  groupThemePackages,
  type managedThemeEntrySchema,
  type ThemeMarketplacePackage,
} from "./theme-marketplace";

/** What a marketplace package adds to Cadencr — the kinds the signed catalog serves today. */
export const PLUGIN_KINDS = ["theme", "provider", "tab"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];
type ManagedThemeEntry = z.infer<typeof managedThemeEntrySchema>;

export function isPluginKind(value: string): value is PluginKind {
  return (PLUGIN_KINDS as readonly string[]).includes(value);
}

interface ListingVersion {
  version: string;
  minApp: string;
  maxApp?: string | null;
  /** Provider or tab backend binary targets (`darwin-aarch64`, …); empty for themes. */
  platforms: string[];
  /**
   * Why it can't be installed on this computer — a custom tab backend with no
   * binary for this platform, or a newer backend protocol. Absent: it can.
   */
  unavailable?: TabVersionUnavailable;
  /** Custom tab: the native backend this exact version ships (`null`: none). */
  nativeCode?: TabNativeCode | null;
  /** Custom tab: why Cadencr's revocation policy blocks this exact version here. */
  blocked?: string;
  /** Theme archive digest — keys verified previews to this exact archive. */
  sha256?: string;
}

interface InstalledState {
  version: string | null;
  /** Provider: running now. Theme: the theme on screen right now. */
  active: boolean;
  /** Theme: the installed document validated and can be applied. Provider: always. */
  usable: boolean;
  /** Provider startup selection, or a custom tab’s global enablement switch. */
  enabled?: boolean;
  /** Theme only: a saved light/dark/manual selection references it. */
  selected?: boolean;
  restartRequired: boolean;
  error?: string | null;
  /** Custom tab: on Cadencr's revocation list, with its reason. */
  blocked?: string | null;
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
  /** Some catalog version installs on this computer (true when none is listed). */
  availableHere: boolean;
  /** Custom tab: the native backend of the installed revision, as Cadencr runs it. */
  installedNativeCode?: TabNativeCode | null;
  /** Custom tab: a verified update staged beside the installed revision, awaiting review. */
  pendingVersion?: string | null;
  /** Custom tab: why the revocation policy blocks that staged update (it can only be discarded). */
  pendingBlocked?: string | null;
}

/** The version a listing currently stands for: installed, else the one on offer. */
export function displayVersion(listing: MarketplaceListing): string | undefined {
  return listing.installed?.version ?? listing.recommended ?? listing.versions[0]?.version;
}

/** The version a detail page offers first: a pending update wins over what is installed. */
export function offeredVersion(listing: MarketplaceListing): string {
  return listing.update ?? listing.installed?.version ?? listing.recommended ?? "";
}

/**
 * The update a user can still download: one already staged (downloaded and
 * verified) only waits for its review, which its badge asks for instead.
 */
export function downloadableUpdate(listing: MarketplaceListing): string | undefined {
  return listing.update === listing.pendingVersion ? undefined : listing.update;
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
    availableHere: versions.length === 0 || versions.some((entry) => !entry.unavailable),
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

function tabVersion(item: TabMarketplacePackage, catalog?: ManagedThemeCatalogResponse) {
  // The service decides what installs here; it parsed the signed entry.
  const unavailable = catalog?.unavailable_versions?.[item.tab.id]?.[item.tab.version];
  const blocked = catalog?.blocked_versions?.[item.tab.id]?.[item.tab.version];
  return {
    ...(blocked ? { blocked } : {}),
    version: item.tab.version,
    minApp: item.host.compatibility.min_app_version,
    maxApp: item.host.compatibility.max_app_version,
    platforms: Object.keys(item.tab.distribution.binary ?? {}),
    ...(unavailable ? { unavailable } : {}),
    sha256: item.tab.distribution.sha256,
    nativeCode: tabNativeCode(item),
  } satisfies ListingVersion;
}

function tabListings(sources: ListingSources): MarketplaceListing[] {
  const groups = groupTabPackages(sources.tabCatalog);
  const entries = new Map((sources.tabInventory ?? []).map((item) => [item.id, item]));
  return [...new Set([...groups.keys(), ...entries.keys()])].map((id) => {
    const versions = groups.get(id) ?? [];
    const installed = entries.get(id);
    const runtime = sources.tabSummaries?.find((item) => item.id === id);
    const recommended = sources.tabCatalog?.recommended_versions[id];
    const meta = pickMeta(versions, (item) => item.tab.version, recommended);
    return {
      ...baseListing(
        "tab",
        id,
        versions.map((item) => tabVersion(item, sources.tabCatalog)),
        recommended,
        installed
          ? {
              version: installed.version,
              active: runtime?.enablement.effective ?? false,
              enabled: runtime?.enablement.global ?? false,
              usable: !installed.error && runtime?.status === "valid",
              restartRequired: false,
              error: installed.error,
              blocked:
                installed.blocked ??
                (runtime?.status === "blocked" ? (runtime.blocked_reason ?? "Blocked") : null),
            }
          : undefined,
      ),
      name: meta?.tab.name ?? installed?.name ?? id,
      description: meta?.tab.description ?? "",
      publisher: meta?.host.publisher,
      repository: meta?.tab.repository,
      license: meta?.tab.license,
      authors: [],
      installedNativeCode: installed && runtime ? runtimeNativeCode(runtime) : null,
      pendingVersion: installed?.pending_version ?? null,
      pendingBlocked: runtime?.pending_update?.blocked_reason ?? null,
    };
  });
}

interface ListingSources {
  providerCatalog?: ManagedCatalogResponse;
  providerInventory?: ManagedProviderInventoryEntry[];
  themeCatalog?: ManagedThemeCatalogResponse;
  themeInventory?: ManagedThemeEntry[];
  displayedThemeId?: string;
  tabCatalog?: ManagedThemeCatalogResponse;
  tabInventory?: ManagedTabInventoryEntry[];
  tabSummaries?: PluginTabSummary[];
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
    ...tabListings(sources),
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
