import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/test-utils";
import {
  applyManagedTheme,
  catalog,
  getManagedThemeCatalog,
  getManagedTabCatalog,
  getManagedTabs,
  pluginTabList,
  installManagedTab,
  updateManagedTab,
  removeManagedTab,
  getManagedThemes,
  install,
  inventory,
  remove,
  update,
  updateManagedTheme,
  type ManagedProviderInventoryEntry,
  type SignedMixedCatalog,
} from "@/api/generated";
import { tabFixture } from "@/components/settings/custom-tabs/custom-tabs-fixtures";
import { MarketplaceProvider } from "./MarketplaceContext";
import { MarketplaceHome } from "./MarketplaceHome";
import { PluginDetail } from "./PluginDetail";
const tabMutations = vi.hoisted(() => ({ consent: vi.fn(), enable: vi.fn() }));

vi.mock("@/lib/marketplace-gate", () => ({ MARKETPLACE_ENABLED: true }));
vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ themeId: "managed:graphite", isLoading: false }),
}));
vi.mock("@/components/SidebarContext", () => ({
  useSidebarCollapsed: () => ({ collapsed: false, setCollapsed: vi.fn() }),
}));
vi.mock("@/components/SidebarCollapsedChrome", () => ({ SidebarCollapsedChrome: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => <a href={params ? `${to}:${Object.values(params).join("/")}` : to}>{children}</a>,
}));
vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>({
    data,
    itemContent,
  }: {
    data: T[];
    itemContent: (i: number, d: T) => ReactNode;
  }) => (
    <div>
      {data.map((entry, index) => (
        <div key={index}>{itemContent(index, entry)}</div>
      ))}
    </div>
  ),
  VirtuosoGrid: <T,>({
    data,
    itemContent,
  }: {
    data: T[];
    itemContent: (i: number, d: T) => ReactNode;
  }) => (
    <div>
      {data.map((entry, index) => (
        <div key={index}>{itemContent(index, entry)}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/api/generated", () => ({
  getManagedTabCatalog: vi.fn(),
  getManagedTabs: vi.fn(),
  pluginTabList: vi.fn(),
  refreshManagedTabCatalog: vi.fn(),
  installManagedTab: vi.fn(),
  updateManagedTab: vi.fn(),
  removeManagedTab: vi.fn(),
  usePluginTabSetEnablement: () => ({ mutateAsync: tabMutations.enable }),
  usePluginTabConsent: () => ({ mutateAsync: tabMutations.consent }),
  catalog: vi.fn(),
  inventory: vi.fn(),
  refreshCatalog: vi.fn(),
  install: vi.fn(),
  update: vi.fn(),
  enabled: vi.fn(),
  remove: vi.fn(),
  getManagedThemes: vi.fn(),
  getManagedThemeCatalog: vi.fn(),
  refreshManagedThemeCatalog: vi.fn(),
  installManagedTheme: vi.fn(),
  updateManagedTheme: vi.fn(),
  applyManagedTheme: vi.fn(),
  removeManagedTheme: vi.fn(),
  duplicateManagedTheme: vi.fn(),
  previewManagedThemePackage: vi.fn(),
}));

const sha = "a".repeat(64);
const index: SignedMixedCatalog = {
  signature: { algorithm: "ed25519", key_id: "release", value: "signed-envelope" },
  signed: {
    schema_version: 2,
    generated_at: "2026-10-01T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    packages: [
      ...["0.1.0", "0.2.0"].map((version) => ({
        kind: "theme",
        package: {
          theme: {
            id: "graphite",
            name: "Graphite",
            description: "Cool charcoal",
            version,
            repository: "https://github.com/cadencr/themes",
            license: "Apache-2.0",
            document_version: 1,
            distribution: { archive: "https://github.com/cadencr/themes/g.tar.gz", sha256: sha },
          },
          host: { publisher: "Cadencr", compatibility: { min_app_version: "0.13.0" } },
        },
      })),
      ...["1.0.0", "2.0.0", "3.0.0"].map((version) => ({
        kind: "provider",
        package: {
          agent: { id: "pi", name: "Pi", version, description: "An ACP agent" },
          host: {
            publisher: "Pi Co",
            compatibility: { min_app_version: "0.1.0" },
            assets: { icon: "icon.svg" },
          },
        },
      })),
    ],
  },
};
const pi: ManagedProviderInventoryEntry = {
  id: "pi",
  version: "3.0.0",
  digest: "digest",
  active_now: true,
  active_after_restart: true,
  enabled_after_restart: true,
  restart_required: false,
  history: [
    { action: "installed", sequence: 1, occurred_at: "2026-09-01T00:00:00Z", version: "3.0.0" },
  ],
  quarantine: [],
};
const control = { status: "applied" as const };
const XTERM_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];
const graphiteDoc = {
  label: "Graphite",
  appearance: "dark",
  cssVars: { "--background": "#171d25" },
  xterm: Object.fromEntries(XTERM_KEYS.map((key) => [key, "#000000"])),
};

function stubBackend(providers: ManagedProviderInventoryEntry[], recommended = "2.0.0") {
  vi.mocked(catalog).mockResolvedValue({
    source_configured: true,
    cache_status: "verified",
    refreshed: true,
    used_cached_verified_catalog: false,
    recommended_versions: { pi: recommended },
    index,
  });
  vi.mocked(inventory).mockResolvedValue({
    providers,
    root: "/test",
    trust: { status: "configured" },
    blocklist: { source_configured: true, cache_status: "verified" },
    process_policy: {
      memory_limit: control,
      child_count_limit: control,
      cpu_limit: control,
      descendant_termination: control,
      default_one_shot_timeout_seconds: 60,
    },
  });
  vi.mocked(getManagedThemeCatalog).mockResolvedValue({
    verified: true,
    recommended_versions: { graphite: "0.2.0" },
    index,
  });
  vi.mocked(getManagedThemes).mockResolvedValue([graphiteEntry("0.1.0")] as never);
}

function graphiteEntry(version: string) {
  return {
    id: "graphite",
    name: "Graphite",
    version,
    sha256: sha,
    active: true,
    theme: {
      id: "managed:graphite",
      path: "/t",
      content: "{}",
      theme: graphiteDoc,
      issues: [],
      assets: {},
    },
  };
}

const inMarketplace = (ui: ReactNode) => render(<MarketplaceProvider>{ui}</MarketplaceProvider>);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getManagedTabCatalog).mockResolvedValue({
    verified: true,
    index,
    recommended_versions: {},
  });
  vi.mocked(getManagedTabs).mockResolvedValue([]);
  vi.mocked(pluginTabList).mockResolvedValue([]);
  tabMutations.consent.mockResolvedValue({});
  tabMutations.enable.mockResolvedValue({});
});

describe("plugin detail", () => {
  it("never offers a downgrade of a newer installed revision and installs nothing until chosen", async () => {
    stubBackend([pi], "2.0.0");
    inMarketplace(<PluginDetail kind="provider" id="pi" />);
    const primary = await screen.findByRole("button", { name: "Installed" });
    expect(primary).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Exact version" })).toHaveTextContent("3.0.0");
  });

  it("installs the recommended exact version with the untouched signed envelope", async () => {
    stubBackend([], "2.0.0");
    vi.mocked(install).mockResolvedValue({ ...pi, version: "2.0.0" });
    const { user } = inMarketplace(<PluginDetail kind="provider" id="pi" />);
    await user.click(await screen.findByRole("button", { name: "Install 2.0.0" }));
    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({ provider_id: "pi", version: "2.0.0", index }),
    );
    expect(await screen.findByText(/pi: changes saved/)).toBeTruthy();
  });

  it("updates a provider in one click when the recommendation is newer", async () => {
    stubBackend([{ ...pi, version: "1.0.0" }], "2.0.0");
    vi.mocked(update).mockResolvedValue({ ...pi, version: "2.0.0" });
    const { user } = inMarketplace(<PluginDetail kind="provider" id="pi" />);
    await user.click(await screen.findByRole("button", { name: "Update to 2.0.0" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("pi", { version: "2.0.0", index }));
  });

  it("removes only after confirmation, and keeps the dialog open with the error on failure", async () => {
    stubBackend([pi]);
    vi.mocked(remove).mockRejectedValue({
      response: { data: { error: "Provider is busy", code: "MANAGED_PROVIDER_BUSY" } },
    });
    const { user } = inMarketplace(<PluginDetail kind="provider" id="pi" />);
    await user.click(await screen.findByRole("button", { name: "Remove Pi…" }));
    expect(remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByText("MANAGED_PROVIDER_BUSY: Provider is busy")).toBeTruthy();
  });

  it("shows the theme on screen as in use and paints its stage from the installed document", async () => {
    stubBackend([]);
    vi.mocked(getManagedThemeCatalog).mockResolvedValue({
      verified: true,
      recommended_versions: { graphite: "0.1.0" },
      index,
    });
    inMarketplace(<PluginDetail kind="theme" id="graphite" />);
    expect(await screen.findByRole("button", { name: "In use" })).toBeDisabled();
    expect(document.querySelector(".mp-stage:not([data-unpainted])")).toBeTruthy();
    expect(applyManagedTheme).not.toHaveBeenCalled();
  });

  it("offers a pending update consistently: select, action and stage name the same version", async () => {
    stubBackend([]);
    vi.mocked(updateManagedTheme).mockResolvedValue({} as never);
    const { user } = inMarketplace(<PluginDetail kind="theme" id="graphite" />);
    await user.click(await screen.findByRole("button", { name: "Update to 0.2.0" }));
    expect(screen.getByRole("combobox", { name: "Exact version" })).toHaveTextContent("0.2.0");
    expect(screen.getByRole("button", { name: /Preview 0\.2\.0/ })).toBeTruthy();
    await waitFor(() =>
      expect(updateManagedTheme).toHaveBeenCalledWith("graphite", {
        theme_id: "graphite",
        version: "0.2.0",
        index,
      }),
    );
  });
});

describe("marketplace home", () => {
  it.each(["installed", "updates"] as const)(
    "does not mistake filtered %s for an empty library",
    async (view) => {
      stubBackend([{ ...pi, version: "1.0.0" }], "2.0.0");
      inMarketplace(
        <MarketplaceHome view={view} kind="all" query="no-match-at-all" onChange={vi.fn()} />,
      );
      expect(
        await screen.findByText(
          view === "updates"
            ? "No updates match your search"
            : "No installed plugins match your search",
        ),
      ).toBeTruthy();
      expect(screen.queryByText("Everything is up to date")).toBeNull();
      expect(screen.queryByText("Nothing installed from the marketplace yet")).toBeNull();
    },
  );

  it("confirms no updates only with verified catalogs", async () => {
    stubBackend([pi], "2.0.0");
    vi.mocked(getManagedThemes).mockResolvedValue([graphiteEntry("0.2.0")] as never);
    inMarketplace(<MarketplaceHome view="updates" kind="all" query="" onChange={vi.fn()} />);
    expect(await screen.findByText("Everything is up to date")).toBeTruthy();
  });

  it("does not claim nothing is installed when an inventory fails", async () => {
    stubBackend([]);
    vi.mocked(getManagedThemes).mockRejectedValue(new Error("Inventory unavailable"));
    inMarketplace(<MarketplaceHome view="installed" kind="all" query="" onChange={vi.fn()} />);
    expect(await screen.findByText("Installed plugins could not be loaded")).toBeTruthy();
    expect(screen.queryByText("Nothing installed from the marketplace yet")).toBeNull();
  });

  it("does not claim updates are current without configured catalogs", async () => {
    stubBackend([]);
    vi.mocked(catalog).mockResolvedValue({
      source_configured: false,
      cache_status: "missing",
      refreshed: false,
      used_cached_verified_catalog: false,
    });
    vi.mocked(getManagedThemeCatalog).mockResolvedValue({
      verified: false,
      recommended_versions: {},
    });
    inMarketplace(<MarketplaceHome view="updates" kind="all" query="" onChange={vi.fn()} />);
    expect(await screen.findByText("Updates could not be determined")).toBeTruthy();
    expect(screen.queryByText("Everything is up to date")).toBeNull();
  });

  it("does not claim updates are current when a catalog request fails", async () => {
    stubBackend([pi], "2.0.0");
    vi.mocked(getManagedThemes).mockResolvedValue([graphiteEntry("0.2.0")] as never);
    vi.mocked(catalog).mockRejectedValue(new Error("Catalog unavailable"));
    inMarketplace(<MarketplaceHome view="updates" kind="all" query="" onChange={vi.fn()} />);
    expect(await screen.findByText("Updates could not be determined")).toBeTruthy();
    expect(screen.queryByText("Everything is up to date")).toBeNull();
  });

  it("counts updates and lists them with a direct exact-version update", async () => {
    stubBackend([{ ...pi, version: "1.0.0" }], "2.0.0");
    const onChange = vi.fn();
    inMarketplace(<MarketplaceHome view="updates" kind="all" query="" onChange={onChange} />);
    expect(await screen.findByRole("button", { name: "Update to 2.0.0" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update to 0.2.0" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Updates 2/ })).toBeTruthy();
  });

  it("updates everything in turn at the exact recommended versions", async () => {
    stubBackend([{ ...pi, version: "1.0.0" }], "2.0.0");
    vi.mocked(updateManagedTheme).mockResolvedValue(graphiteEntry("0.2.0") as never);
    vi.mocked(update).mockResolvedValue({ ...pi, version: "2.0.0" });
    const { user } = inMarketplace(
      <MarketplaceHome view="updates" kind="all" query="" onChange={vi.fn()} />,
    );
    await user.click(await screen.findByRole("button", { name: "Update all 2" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("pi", { version: "2.0.0", index }));
    expect(updateManagedTheme).toHaveBeenCalledWith("graphite", {
      theme_id: "graphite",
      version: "0.2.0",
      index,
    });
    expect(vi.mocked(updateManagedTheme).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(update).mock.invocationCallOrder[0],
    );
  });

  it("stops update-all at the first failure and says why", async () => {
    stubBackend([{ ...pi, version: "1.0.0" }], "2.0.0");
    vi.mocked(updateManagedTheme).mockRejectedValue({
      response: { data: { error: "Archive digest mismatch", code: "THEME_DIGEST_MISMATCH" } },
    });
    const { user } = inMarketplace(
      <MarketplaceHome view="updates" kind="all" query="" onChange={vi.fn()} />,
    );
    await user.click(await screen.findByRole("button", { name: "Update all 2" }));
    expect(
      await screen.findByText("Update all stopped: THEME_DIGEST_MISMATCH: Archive digest mismatch"),
    ).toBeTruthy();
    expect(update).not.toHaveBeenCalled();
  });

  it("shows type shelves with honest copy and no invented ranking", async () => {
    stubBackend([]);
    inMarketplace(<MarketplaceHome view="discover" kind="all" query="" onChange={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: /Themes/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Providers/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Showcase" })).toBeTruthy();
    expect(screen.queryByText(/featured|popular|trending/i)).toBeNull();
  });

  it("says when no verified catalog is available, keeping installed reachable", async () => {
    stubBackend([pi]);
    vi.mocked(getManagedTabCatalog).mockResolvedValue({
      verified: false,
      index: null,
      recommended_versions: {},
    });
    vi.mocked(catalog).mockResolvedValue({
      source_configured: false,
      cache_status: "missing",
      refreshed: false,
      used_cached_verified_catalog: false,
    });
    vi.mocked(getManagedThemeCatalog).mockResolvedValue({
      verified: false,
      recommended_versions: {},
    });
    inMarketplace(<MarketplaceHome view="discover" kind="all" query="" onChange={vi.fn()} />);
    expect(await screen.findByText("No verified catalog right now")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Installed 2/ })).toBeTruthy();
  });
});

const tabEntry = (version: string) => ({
  kind: "tab",
  package: {
    tab: {
      id: "graph",
      name: "Files graph",
      description: "Explore changed files",
      version,
      repository: "https://github.com/acme/tabs",
      license: "MIT",
      api_version: 1,
      distribution: {
        archive: `https://github.com/acme/tabs/releases/download/v${version}/tab.tar.gz`,
        sha256: sha,
      },
    },
    host: { publisher: "acme", compatibility: { min_app_version: "0.13.0" } },
  },
});
function stubTabs(installed = false) {
  stubBackend([]);
  const tabIndex = {
    ...index,
    signed: { ...index.signed, packages: [tabEntry("1.0.0"), tabEntry("1.1.0")] },
  };
  vi.mocked(getManagedTabCatalog).mockResolvedValue({
    index: tabIndex,
    verified: true,
    recommended_versions: { graph: "1.1.0" },
  });
  if (installed) {
    vi.mocked(getManagedTabs).mockResolvedValue([
      { id: "graph", name: "Files graph", version: "1.0.0", error: null },
    ]);
    vi.mocked(pluginTabList).mockResolvedValue([
      tabFixture({ id: "graph", name: "Files graph", managed: true }),
    ]);
  }
  return tabIndex;
}
describe("custom tabs in the marketplace", () => {
  it("requires accepted consent before enabling an installed tab", async () => {
    stubTabs(true);
    let confirmConsent!: () => void;
    tabMutations.consent.mockReturnValue(
      new Promise<void>((resolve) => {
        confirmConsent = resolve;
      }),
    );
    const { user } = inMarketplace(<PluginDetail kind="tab" id="graph" />);
    await user.click(await screen.findByRole("button", { name: "Enable" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(tabMutations.consent).not.toHaveBeenCalled();
    expect(tabMutations.enable).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Enable" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow and turn on" }),
    );
    expect(tabMutations.consent).toHaveBeenCalledWith({
      id: "graph",
      data: { permissions_hash: "hash-1" },
    });
    expect(tabMutations.enable).not.toHaveBeenCalled();
    confirmConsent();
    await waitFor(() =>
      expect(tabMutations.enable).toHaveBeenCalledWith({
        id: "graph",
        data: { project_id: null, enabled: true },
      }),
    );
  });

  it("reviews changed permissions without changing the saved enablement switch", async () => {
    stubTabs(true);
    vi.mocked(pluginTabList).mockResolvedValue([
      tabFixture({
        id: "graph",
        name: "Files graph",
        managed: true,
        permissions_hash: "updated-permissions",
        enablement: { global: true, project: null, effective: false, consent_required: true },
      }),
    ]);
    const { user } = inMarketplace(<PluginDetail kind="tab" id="graph" />);
    await user.click(await screen.findByRole("button", { name: "Review permissions" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow" }),
    );
    await waitFor(() =>
      expect(tabMutations.consent).toHaveBeenCalledWith({
        id: "graph",
        data: { permissions_hash: "updated-permissions" },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(tabMutations.enable).not.toHaveBeenCalled();
  });

  it("installs an exact tab version with its original signed catalog", async () => {
    const tabIndex = stubTabs();
    vi.mocked(installManagedTab).mockResolvedValue({
      id: "graph",
      name: "Files graph",
      version: "1.1.0",
      error: null,
    });
    const { user } = inMarketplace(<PluginDetail kind="tab" id="graph" />);
    await user.click(await screen.findByRole("button", { name: "Install 1.1.0" }));
    await waitFor(() =>
      expect(installManagedTab).toHaveBeenCalledWith({
        tab_id: "graph",
        version: "1.1.0",
        index: tabIndex,
      }),
    );
    expect(install).not.toHaveBeenCalled();
    expect(await screen.findByText("graph: install confirmed by Cadencr.")).toBeInTheDocument();
  });
  it("updates a tab without sending it to the provider or theme endpoints", async () => {
    const tabIndex = stubTabs(true);
    vi.mocked(updateManagedTab).mockResolvedValue({
      id: "graph",
      name: "Files graph",
      version: "1.1.0",
      error: null,
    });
    const { user } = inMarketplace(<PluginDetail kind="tab" id="graph" />);
    await user.click(await screen.findByRole("button", { name: "Update to 1.1.0" }));
    await waitFor(() =>
      expect(updateManagedTab).toHaveBeenCalledWith("graph", {
        tab_id: "graph",
        version: "1.1.0",
        index: tabIndex,
      }),
    );
    expect(updateManagedTheme).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it("removes a tab only after confirmation", async () => {
    stubTabs(true);
    vi.mocked(removeManagedTab).mockResolvedValue(true);
    const { user } = inMarketplace(<PluginDetail kind="tab" id="graph" />);
    await user.click(await screen.findByRole("button", { name: "Remove Files graph…" }));
    expect(removeManagedTab).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeManagedTab).toHaveBeenCalledWith("graph"));
  });
});
