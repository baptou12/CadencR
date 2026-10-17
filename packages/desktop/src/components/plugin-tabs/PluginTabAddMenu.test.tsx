import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PluginTabSummary } from "@/api/generated";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { getPluginTabs } from "@/stores/feature-layout-tree";
import { render, screen } from "@/test-utils";

import { createPluginTabsBridgeMock, pluginTabSummary } from "./plugin-tab-fixtures";
import { PluginTabAddMenu } from "./PluginTabAddMenu";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  tabs: [] as PluginTabSummary[],
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/generated")>()),
  usePluginTabList: () => ({ data: mocks.tabs, isLoading: false, error: null }),
}));

const OFF = { global: false, project: null, effective: false, consent_required: false };
let bridge: ReturnType<typeof createPluginTabsBridgeMock>["bridge"];
const setBrowserSuppressed = vi.fn(() => Promise.resolve());

beforeEach(() => {
  bridge = createPluginTabsBridgeMock().bridge;
  setDesktopBridgeOverrideForTests({ isElectron: true, pluginTabs: bridge, setBrowserSuppressed });
  useFeatureLayoutStore.setState({ features: {} });
  mocks.navigate.mockClear();
  setBrowserSuppressed.mockClear();
  mocks.tabs = [
    pluginTabSummary(),
    pluginTabSummary({ id: "ci", name: "CI", label: "Pipelines", description: "GitLab pipelines" }),
    pluginTabSummary({ id: "off", name: "Off", label: "Disabled tab", enablement: OFF }),
  ];
});

afterEach(() => {
  clearDesktopBridgeOverrideForTests();
});

function placedTabs(): string[] {
  return getPluginTabs(selectFeatureLayout(7)(useFeatureLayoutStore.getState()).splitRoot);
}

async function openMenu() {
  const view = render(<PluginTabAddMenu featureId={7} projectId={1} />);
  await view.user.click(screen.getByRole("button", { name: "Add custom tab" }));
  return view;
}

describe("PluginTabAddMenu", () => {
  it("lists the project's enabled tabs and suppresses native views while open", async () => {
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Graph" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Pipelines" })).toBeInTheDocument();
    expect(screen.getByText("GitLab pipelines")).toBeInTheDocument();
    expect(screen.queryByText("Disabled tab")).not.toBeInTheDocument();
    expect(setBrowserSuppressed).toHaveBeenLastCalledWith(true);
  });

  it("adds a tab to the layout, and activates instead of duplicating a placed one", async () => {
    const { user } = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Pipelines" }));
    expect(placedTabs()).toEqual(["plugin:ci"]);

    await user.click(screen.getByRole("button", { name: "Add custom tab" }));
    expect(screen.getByRole("menuitem", { name: "Pipelines (open)" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Pipelines (open)" }));
    expect(placedTabs()).toEqual(["plugin:ci"]);
  });

  it("links to the settings section and the create dialog", async () => {
    const { user } = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: /Create custom tab/ }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { section: "custom-tabs", action: "create" },
    });
    await user.click(screen.getByRole("button", { name: "Add custom tab" }));
    await user.click(screen.getByRole("menuitem", { name: /Manage custom tabs/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      to: "/settings",
      search: { section: "custom-tabs" },
    });
  });

  it("offers reload and DevTools for the focused custom tab", async () => {
    useFeatureLayoutStore.getState().addTab(7, "plugin:graph");
    const { user } = await openMenu();
    expect(screen.getByRole("menuitem", { name: "Reload" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open source project" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Open DevTools" }));
    expect(bridge.openDevTools).toHaveBeenCalledWith("7:plugin:graph");
  });

  it("says so when no tab is on for the project", async () => {
    mocks.tabs = [pluginTabSummary({ enablement: OFF })];
    await openMenu();
    expect(screen.getByText("No custom tab is on for this project yet.")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reload" })).not.toBeInTheDocument();
  });
});
