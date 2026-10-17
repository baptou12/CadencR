import { DndContext } from "@dnd-kit/core";
import {
  BotIcon,
  CodeIcon,
  GitCompareArrowsIcon,
  FileTextIcon,
  GlobeIcon,
  TerminalIcon,
} from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { noteUserLayoutChange } from "@/lib/auto-layout/auto-layout-controller";
import { ROOT_LEAF_ID, type LayoutLeaf } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { makeTabHostKey, useTabHostRegistry } from "@/stores/tab-host-registry";

import { TabPane } from "./TabPane";
import type { FeatureTabs } from "./types";

vi.mock("@/lib/auto-layout/auto-layout-controller", () => ({ noteUserLayoutChange: vi.fn() }));
vi.mock("./AutoLayoutToggle", () => ({ AutoLayoutToggle: (): null => null }));
vi.mock("./LayoutMenu", () => ({
  LayoutMenu: (): null => null,
}));

const FEATURE_ID = 7;
const ROOT_HOST_KEY = makeTabHostKey(FEATURE_ID, ROOT_LEAF_ID);

const leaf: LayoutLeaf = {
  type: "leaf",
  id: ROOT_LEAF_ID,
  tabIds: ["agent", "terminal", "git", "editor", "browser"],
  activeTabId: "agent",
};

const tabs: FeatureTabs = {
  agent: { label: "Agent", Icon: BotIcon, content: null },
  terminal: { label: "Terminal", Icon: TerminalIcon, content: null },
  git: { label: "Git", Icon: GitCompareArrowsIcon, content: null },
  editor: { label: "Editor", Icon: CodeIcon, content: null },
  browser: { label: "Browser", Icon: GlobeIcon, content: null },
  preview: { label: "Preview", Icon: FileTextIcon, content: null },
};

function resetStores(): void {
  vi.mocked(noteUserLayoutChange).mockClear();
  useFeatureLayoutStore.setState({ features: {} });
  useTabHostRegistry.setState({ hosts: {} });
}

describe("TabPane", () => {
  beforeEach(resetStores);

  it("registers and unregisters its content host", () => {
    const view = render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={leaf} tabs={tabs} />
      </DndContext>,
    );

    expect(useTabHostRegistry.getState().hosts[ROOT_HOST_KEY]).toBeInstanceOf(HTMLDivElement);

    view.unmount();

    expect(useTabHostRegistry.getState().hosts[ROOT_HOST_KEY]).toBeUndefined();
  });

  it("calls activation handlers when terminal or editor tabs become active", () => {
    const onTerminalActivate = vi.fn();
    const onEditorActivate = vi.fn();
    render(
      <DndContext>
        <TabPane
          featureId={FEATURE_ID}
          leaf={leaf}
          tabs={tabs}
          onTerminalActivate={onTerminalActivate}
          onEditorActivate={onEditorActivate}
        />
      </DndContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: /terminal/i }));
    expect(onTerminalActivate).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /editor/i }));
    expect(onEditorActivate).toHaveBeenCalledOnce();
  });

  it("calls activation handlers when the active terminal tab is clicked", () => {
    const onTerminalActivate = vi.fn();
    render(
      <DndContext>
        <TabPane
          featureId={FEATURE_ID}
          leaf={{ ...leaf, activeTabId: "terminal" }}
          tabs={tabs}
          onTerminalActivate={onTerminalActivate}
        />
      </DndContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: /terminal/i }));

    expect(onTerminalActivate).toHaveBeenCalledOnce();
  });

  it("renders the dock action outside the tab trigger button", () => {
    const splitLeaf: LayoutLeaf = {
      type: "leaf",
      id: "split-pane",
      tabIds: ["terminal"],
      activeTabId: "terminal",
    };
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={splitLeaf} tabs={tabs} />
      </DndContext>,
    );

    const dockButton = screen.getByRole("button", {
      name: "Return Terminal to the root tab strip",
    });
    const terminalTab = screen.getByText("Terminal").closest("button");
    if (!(terminalTab instanceof HTMLElement)) throw new Error("Terminal tab was not rendered");

    expect(dockButton.closest("[data-slot='tabs-trigger']")).toBeNull();
    expect(dockButton).not.toHaveClass("opacity-0");
    expect(terminalTab).toHaveClass("pr-8");
  });

  it("only leaves the active underline visible in the focused pane", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        children: [
          { ...leaf, activeTabId: "terminal" },
          { type: "leaf", id: "other", tabIds: ["git"], activeTabId: "git" },
        ],
      },
      focusedPaneId: "other",
      appliedLayoutId: null,
    });
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={{ ...leaf, activeTabId: "terminal" }} tabs={tabs} />
      </DndContext>,
    );

    const terminalTab = screen.getByText("Terminal").closest("button");
    if (!(terminalTab instanceof HTMLElement)) throw new Error("Terminal tab was not rendered");
    expect(terminalTab).toHaveClass("data-[state=active]:after:bg-transparent");
  });

  it("only counts switching to another tab as a manual layout change", () => {
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={leaf} tabs={tabs} />
      </DndContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: /agent/i }));
    expect(noteUserLayoutChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /terminal/i }));
    expect(noteUserLayoutChange).toHaveBeenCalledWith(FEATURE_ID);
  });

  it("marks the pane focused when clicking an already-active tab", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        children: [
          { ...leaf, activeTabId: "terminal" },
          { type: "leaf", id: "other", tabIds: ["git"], activeTabId: "git" },
        ],
      },
      focusedPaneId: "other",
      appliedLayoutId: null,
    });
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={{ ...leaf, activeTabId: "terminal" }} tabs={tabs} />
      </DndContext>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /terminal/i }));

    expect(useFeatureLayoutStore.getState().features[FEATURE_ID]?.focusedPaneId).toBe(ROOT_LEAF_ID);
  });

  it("marks the pane focused when activating an already-active tab by click", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        children: [
          { ...leaf, activeTabId: "terminal" },
          { type: "leaf", id: "other", tabIds: ["git"], activeTabId: "git" },
        ],
      },
      focusedPaneId: "other",
      appliedLayoutId: null,
    });
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={{ ...leaf, activeTabId: "terminal" }} tabs={tabs} />
      </DndContext>,
    );

    fireEvent.click(screen.getByRole("button", { name: /terminal/i }));

    expect(useFeatureLayoutStore.getState().features[FEATURE_ID]?.focusedPaneId).toBe(ROOT_LEAF_ID);
  });

  it("marks the pane focused when clicking inside tab content", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        children: [
          { ...leaf, activeTabId: "terminal" },
          { type: "leaf", id: "other", tabIds: ["git"], activeTabId: "git" },
        ],
      },
      focusedPaneId: "other",
      appliedLayoutId: null,
    });
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={{ ...leaf, activeTabId: "terminal" }} tabs={tabs} />
      </DndContext>,
    );

    const host = useTabHostRegistry.getState().hosts[ROOT_HOST_KEY];
    const contentChild = document.createElement("button");
    contentChild.addEventListener("pointerdown", (event) => event.stopPropagation());
    host.appendChild(contentChild);

    fireEvent.pointerDown(contentChild);

    expect(useFeatureLayoutStore.getState().features[FEATURE_ID]?.focusedPaneId).toBe(ROOT_LEAF_ID);
  });

  it("marks the pane focused when focus moves inside tab content", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, {
      version: 1,
      splitRoot: {
        type: "split",
        orientation: "horizontal",
        children: [
          { ...leaf, activeTabId: "terminal" },
          { type: "leaf", id: "other", tabIds: ["git"], activeTabId: "git" },
        ],
      },
      focusedPaneId: "other",
      appliedLayoutId: null,
    });
    render(
      <DndContext>
        <TabPane featureId={FEATURE_ID} leaf={{ ...leaf, activeTabId: "terminal" }} tabs={tabs} />
      </DndContext>,
    );

    const host = useTabHostRegistry.getState().hosts[ROOT_HOST_KEY];
    const contentChild = document.createElement("button");
    host.appendChild(contentChild);

    fireEvent.focusIn(contentChild);

    expect(useFeatureLayoutStore.getState().features[FEATURE_ID]?.focusedPaneId).toBe(ROOT_LEAF_ID);
  });

  describe("closable (plugin) tabs", () => {
    const GRAPH = "plugin:graph" as const;
    const pluginTabs: FeatureTabs = {
      ...tabs,
      [GRAPH]: {
        label: "Graph",
        iconNode: <svg data-testid="graph-icon" />,
        content: null,
        closable: true,
      },
    };
    const rootWithGraph: LayoutLeaf = { ...leaf, tabIds: [...leaf.tabIds, GRAPH] };

    it("shows a close button in the root pane that removes the tab", () => {
      useFeatureLayoutStore.getState().addTab(FEATURE_ID, GRAPH, { activate: false });
      render(
        <DndContext>
          <TabPane featureId={FEATURE_ID} leaf={rootWithGraph} tabs={pluginTabs} />
        </DndContext>,
      );

      expect(screen.getByTestId("graph-icon")).toBeInTheDocument();
      // Built-ins in the root strip still have no X.
      expect(screen.queryByRole("button", { name: /Return .* to the root tab strip/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Close Agent" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Close Graph" }));

      expect(noteUserLayoutChange).toHaveBeenCalledWith(FEATURE_ID, { structural: true });
      const stored = useFeatureLayoutStore.getState().features[FEATURE_ID];
      expect(stored?.splitRoot).toMatchObject({ tabIds: leaf.tabIds });
    });

    it("closes rather than docks from a floating pane", () => {
      const floating: LayoutLeaf = { type: "leaf", id: "p", tabIds: [GRAPH], activeTabId: GRAPH };
      render(
        <DndContext>
          <TabPane featureId={FEATURE_ID} leaf={floating} tabs={pluginTabs} />
        </DndContext>,
      );
      expect(screen.getByRole("button", { name: "Close Graph" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Return Graph/ })).toBeNull();
    });

    it("skips tabs that have no definition", () => {
      render(
        <DndContext>
          <TabPane featureId={FEATURE_ID} leaf={rootWithGraph} tabs={tabs} />
        </DndContext>,
      );
      expect(screen.queryByText("Graph")).toBeNull();
      expect(screen.getByText("Agent")).toBeInTheDocument();
    });

    it("renders root strip actions, even with splits off", () => {
      render(
        <DndContext>
          <TabPane
            featureId={FEATURE_ID}
            leaf={leaf}
            tabs={tabs}
            splitsEnabled={false}
            rootStripActions={<button type="button">Add tab</button>}
          />
        </DndContext>,
      );
      expect(screen.getByRole("button", { name: "Add tab" })).toBeInTheDocument();
    });
  });
});
