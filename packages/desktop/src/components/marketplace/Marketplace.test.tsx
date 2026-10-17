import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/test-utils";
import {
  applyManagedTheme,
  catalog,
  getManagedThemeCatalog,
  getManagedThemes,
  install,
  inventory,
  remove,
  update,
  updateManagedTheme,
  type ManagedProviderInventoryEntry,
  type SignedMixedCatalog,
} from "@/api/generated";
import { MarketplaceProvider } from "./MarketplaceContext";
import { MarketplaceHome } from "./MarketplaceHome";
import { PluginDetail } from "./PluginDetail";

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
