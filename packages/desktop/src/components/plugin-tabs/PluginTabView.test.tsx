import { act } from "react";
import type { TabContext } from "@cadencr/tab-sdk/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { render, screen, waitFor } from "@/test-utils";

import { createPluginTabsBridgeMock, pluginTabSummary } from "./plugin-tab-fixtures";
import { PluginTabView } from "./PluginTabView";

const navigate = vi.fn(() => Promise.resolve());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const CONTEXT: TabContext = {
  project: { id: 1, name: "Cadencr", path: "/repo" },
  feature: { id: 7, name: "Graph", branch: null, baseBranch: null, worktreePath: null },
  pullRequest: null,
  session: null,
};

let mock: ReturnType<typeof createPluginTabsBridgeMock>;

beforeEach(() => {
  mock = createPluginTabsBridgeMock();
  setDesktopBridgeOverrideForTests({ isElectron: true, pluginTabs: mock.bridge });
  useFeatureLayoutStore.setState({ features: {} });
  useFeatureLayoutStore.getState().addTab(7, "plugin:graph");
  navigate.mockClear();
});

afterEach(() => {
  clearDesktopBridgeOverrideForTests();
});

function renderView(overrides: Parameters<typeof pluginTabSummary>[0] = {}) {
  return render(
    <PluginTabView featureId={7} summary={pluginTabSummary(overrides)} context={CONTEXT} />,
  );
}

describe("PluginTabView", () => {
  it("opens the guest, keeps it hidden while loading, then shows it once loaded", async () => {
    renderView();
    expect(screen.getByRole("status", { name: "Loading Changed files graph" })).toBeInTheDocument();
    await waitFor(() => expect(mock.bridge.open).toHaveBeenCalledWith("7:plugin:graph", "graph"));
    expect(mock.bridge.setTheme).toHaveBeenCalled();
    expect(mock.bridge.setVisible).toHaveBeenLastCalledWith("7:plugin:graph", false);

    act(() => mock.emit({ instanceId: "7:plugin:graph", type: "loaded" }));

    await waitFor(() =>
      expect(mock.bridge.setVisible).toHaveBeenLastCalledWith("7:plugin:graph", true),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("closes the guest on unmount", async () => {
    const view = renderView();
    await waitFor(() => expect(mock.bridge.open).toHaveBeenCalled());
    view.unmount();
    expect(mock.bridge.close).toHaveBeenCalledWith("7:plugin:graph");
  });

  it("offers Reload after a crash", async () => {
    const { user } = renderView();
    await waitFor(() => expect(mock.bridge.open).toHaveBeenCalled());
    act(() => mock.emit({ instanceId: "7:plugin:graph", type: "crashed", detail: "oom" }));
    expect(await screen.findByText("Changed files graph stopped")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(mock.bridge.reload).toHaveBeenCalledWith("7:plugin:graph");
  });

  it("shows the load failure detail", async () => {
    renderView();
    await waitFor(() => expect(mock.bridge.open).toHaveBeenCalled());
    act(() => mock.emit({ instanceId: "7:plugin:graph", type: "load-failed", detail: "HTTP 404" }));
    expect(await screen.findByText("Changed files graph failed to load")).toBeInTheDocument();
    expect(screen.getByText("HTTP 404")).toBeInTheDocument();
  });

  it("explains how to build a tab without a dist/ entry, without opening a guest", () => {
    renderView({ entry_present: false });
    expect(screen.getByText("Changed files graph isn't built yet")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    expect(screen.getByText("in /Users/me/.cadencr/plugins/tabs/graph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open project" })).toBeInTheDocument();
    expect(mock.bridge.open).not.toHaveBeenCalled();
  });

  it("lists manifest errors for an invalid tab", async () => {
    const { user } = renderView({
      status: "invalid",
      errors: [{ code: "PERMISSION_UNKNOWN", field: "permissions[0]", message: "Unknown scope" }],
    });
    expect(screen.getByText("Changed files graph can't load")).toBeInTheDocument();
    expect(screen.getByText("PERMISSION_UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("Unknown scope")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage custom tabs" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/settings", search: { section: "custom-tabs" } });
    expect(mock.bridge.open).not.toHaveBeenCalled();
  });

  it("explains a tab that is off for the project", () => {
    renderView({
      enablement: { global: false, project: null, effective: false, consent_required: false },
    });
    expect(screen.getByText("Changed files graph is off")).toBeInTheDocument();
    expect(mock.bridge.open).not.toHaveBeenCalled();
  });

  it("shows a desktop-only placeholder outside the desktop app", () => {
    setDesktopBridgeOverrideForTests({ isElectron: false, pluginTabs: mock.bridge });
    renderView();
    expect(screen.getByText("Desktop only")).toBeInTheDocument();
    expect(mock.bridge.open).not.toHaveBeenCalled();
  });
});
