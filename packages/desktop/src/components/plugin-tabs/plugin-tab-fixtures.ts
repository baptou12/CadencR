import type { PluginTabSummary } from "@/api/generated";
import type { PluginTabEvent, PluginTabsBridge } from "@/shared/plugin-tab-host";
import { vi } from "vitest";

/** A valid, enabled, built custom tab; override what a test is about. */
export function pluginTabSummary(overrides: Partial<PluginTabSummary> = {}): PluginTabSummary {
  return {
    id: "graph",
    name: "Changed files graph",
    label: "Graph",
    version: "0.1.0",
    description: "Graph of the files this feature changed.",
    api_version: 1,
    entry: "dist/index.html",
    entry_present: true,
    icon_svg: null,
    dir: "/Users/me/.cadencr/plugins/tabs/graph",
    authoring_project_id: 3,
    permissions: ["git:read"],
    network: { allowed_origins: [], reasoning: null },
    configuration: [],
    permissions_hash: "abc",
    status: "valid",
    errors: [],
    warnings: [],
    enablement: { global: true, project: null, effective: true, consent_required: false },
    ...overrides,
  };
}

/** `desktopBridge.pluginTabs` with spies, plus a way to fire host events. */
export function createPluginTabsBridgeMock() {
  const listeners = new Set<(event: PluginTabEvent) => void>();
  const bridge = {
    open: vi.fn(() => Promise.resolve()),
    setBounds: vi.fn(() => Promise.resolve()),
    setVisible: vi.fn(() => Promise.resolve()),
    reload: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    openDevTools: vi.fn(() => Promise.resolve()),
    focus: vi.fn(() => Promise.resolve()),
    setTheme: vi.fn(() => Promise.resolve()),
    onEvent: vi.fn((listener: (event: PluginTabEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } satisfies PluginTabsBridge;
  const emit = (event: PluginTabEvent): void => {
    for (const listener of listeners) listener(event);
  };
  return { bridge, emit };
}
