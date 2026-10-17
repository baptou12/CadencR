import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@/test-utils";
import type { PluginTabSummary, Project } from "@/api/generated";
import { projectFixture, serviceError, tabFixture } from "./custom-tabs-fixtures";
import { CustomTabsSection } from "./CustomTabsSection";

const mocks = vi.hoisted(() => ({
  tabs: [] as PluginTabSummary[],
  projects: [] as Project[],
  /** project id → that project's list (its overrides). */
  perProject: new Map<number, PluginTabSummary[]>(),
  fresh: null as PluginTabSummary | null,
  search: {} as Record<string, unknown>,
  navigate: vi.fn(() => Promise.resolve()),
  setEnablement: vi.fn(),
  consent: vi.fn(),
  workspace: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: ({ select }: { select: (search: Record<string, unknown>) => unknown }) =>
    select(mocks.search),
}));

vi.mock("@/api/generated", async (importOriginal) => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...(await importOriginal<typeof import("@/api/generated")>()),
    usePluginTabList: () => useQuery({ queryKey: ["/api/plugin-tabs"], queryFn: () => mocks.tabs }),
    getPluginTabListQueryOptions: (params: { project_id: number }) => ({
      queryKey: ["/api/plugin-tabs", params],
      queryFn: () => mocks.perProject.get(params.project_id) ?? [],
    }),
    getPluginTabGetQueryOptions: (id: string) => ({
      queryKey: [`/api/plugin-tabs/${id}`],
      queryFn: () => mocks.fresh,
    }),
    useListProjects: () => useQuery({ queryKey: ["/api/projects"], queryFn: () => mocks.projects }),
    usePluginTabSetEnablement: () => useMutation({ mutationFn: mocks.setEnablement }),
    usePluginTabConsent: () => useMutation({ mutationFn: mocks.consent }),
    usePluginTabWorkspace: () => useMutation({ mutationFn: mocks.workspace }),
    usePluginTabAuthoring: () => useMutation({ mutationFn: vi.fn() }),
  };
});

const listFor = (projectId: number, project: boolean | null): void => {
  mocks.perProject.set(projectId, [
    tabFixture({ enablement: { ...tabFixture().enablement, project } }),
  ]);
};

describe("CustomTabsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tabs = [];
    mocks.projects = [];
    mocks.perProject = new Map();
    mocks.fresh = null;
    mocks.search = {};
    mocks.setEnablement.mockResolvedValue(tabFixture());
    mocks.consent.mockResolvedValue(tabFixture());
  });

  it("explains custom tabs and offers to create one when there are none", async () => {
    render(<CustomTabsSection />);
    expect(await screen.findByText("No custom tabs yet")).toBeInTheDocument();
    expect(screen.getByText("Desktop only")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Create custom tab" });
    expect(screen.getAllByRole("button", { name: "Create custom tab" })).toHaveLength(1);
  });

  it("shows each tab's status and where it is on", async () => {
    mocks.projects = [projectFixture(1, "app"), projectFixture(2, "api")];
    listFor(1, true);
    listFor(2, null);
    mocks.tabs = [
      tabFixture(),
      tabFixture({ id: "broken", name: "Broken", status: "invalid" }),
      tabFixture({ id: "draft", name: "Draft", entry_present: false }),
      tabFixture({
        id: "everywhere",
        name: "Everywhere",
        enablement: { global: true, project: null, effective: true, consent_required: false },
      }),
    ];
    render(<CustomTabsSection />);

    const card = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
    await screen.findByText("Changed files graph");
    expect(within(card("Changed files graph")).getByText("Valid")).toBeInTheDocument();
    expect(within(card("Broken")).getByText("Invalid")).toBeInTheDocument();
    expect(within(card("Draft")).getByText("Not built")).toBeInTheDocument();
    expect(within(card("Everywhere")).getByText("On everywhere")).toBeInTheDocument();
    expect(within(card("Draft")).getByText("Off")).toBeInTheDocument();
    // The graph overrides project 1 on (per-project list), but has no consent.
    await waitFor(() =>
      expect(within(card("Changed files graph")).getByText("Needs consent")).toBeInTheDocument(),
    );
  });

  it("asks for consent before the global switch turns a tab on", async () => {
    mocks.tabs = [tabFixture()];
    const { user } = render(<CustomTabsSection />);
    await screen.findByRole("button", { name: /Changed files graph/, expanded: true });
    await user.click(screen.getByRole("switch", { name: /Enable in all projects/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/runs code from/)).toBeInTheDocument();
    expect(within(dialog).getByText("git:read")).toBeInTheDocument();
    expect(mocks.setEnablement).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Allow and turn on" }));
    await waitFor(() => expect(mocks.setEnablement).toHaveBeenCalled());
    expect(mocks.consent.mock.calls[0]?.[0]).toEqual({
      id: "graph",
      data: { permissions_hash: "hash-1" },
    });
    expect(mocks.setEnablement.mock.calls[0]?.[0]).toEqual({
      id: "graph",
      data: { project_id: null, enabled: true },
    });
  });

  it("cancelling consent changes nothing", async () => {
    mocks.tabs = [tabFixture()];
    const { user } = render(<CustomTabsSection />);
    await screen.findByRole("button", { name: /Changed files graph/, expanded: true });
    await user.click(screen.getByRole("switch", { name: /Enable in all projects/ }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.consent).not.toHaveBeenCalled();
    expect(mocks.setEnablement).not.toHaveBeenCalled();
  });

  it("shows the updated permissions when the consent went stale", async () => {
    mocks.tabs = [tabFixture()];
    mocks.consent.mockRejectedValueOnce(serviceError(409, "PLUGIN_TAB_CONSENT_STALE", "changed"));
    mocks.fresh = tabFixture({ permissions: ["workspace:read"], permissions_hash: "hash-2" });
    const { user } = render(<CustomTabsSection />);
    await screen.findByRole("button", { name: /Changed files graph/, expanded: true });
    await user.click(screen.getByRole("switch", { name: /Enable in all projects/ }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Allow and turn on" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/changed its permissions/)).toBeInTheDocument();
    expect(within(dialog).getByText("workspace:read")).toBeInTheDocument();
    expect(mocks.setEnablement).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Allow and turn on" }));
    await waitFor(() => expect(mocks.setEnablement).toHaveBeenCalled());
    expect(mocks.consent.mock.calls[1]?.[0]).toMatchObject({
      data: { permissions_hash: "hash-2" },
    });
  });

  it("sets and clears a project override without consent when it is current", async () => {
    mocks.projects = [projectFixture(7, "app")];
    listFor(7, false);
    const consented = { global: null, project: null, effective: false, consent_required: false };
    mocks.tabs = [tabFixture({ enablement: consented })];
    const { user } = render(<CustomTabsSection />);
    await screen.findByRole("button", { name: /Changed files graph/, expanded: true });

    const group = await screen.findByRole("radiogroup", { name: "app availability" });
    await waitFor(() =>
      expect(within(group).getByRole("radio", { name: "Off" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    await user.click(within(group).getByRole("radio", { name: "On" }));
    await waitFor(() => expect(mocks.setEnablement).toHaveBeenCalledTimes(1));
    expect(mocks.setEnablement.mock.calls[0]?.[0]).toEqual({
      id: "graph",
      data: { project_id: 7, enabled: true },
    });
    await user.click(within(group).getByRole("radio", { name: "Inherit" }));
    await waitFor(() => expect(mocks.setEnablement).toHaveBeenCalledTimes(2));
    expect(mocks.setEnablement.mock.calls[1]?.[0]).toEqual({
      id: "graph",
      data: { project_id: 7, enabled: null },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the create dialog from action=create and drops the param", async () => {
    mocks.search = { section: "custom-tabs", action: "create" };
    render(<CustomTabsSection />);
    expect(await screen.findByRole("dialog", { name: "Create custom tab" })).toBeInTheDocument();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { section: "custom-tabs" },
      replace: true,
    });
  });
});
