import { DndContext } from "@dnd-kit/core";
import { BotIcon, CodeIcon, GitCompareArrowsIcon, TerminalIcon } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ROOT_LEAF_ID, type LayoutLeaf } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { useTabHostRegistry } from "@/stores/tab-host-registry";

import { TabPane } from "./TabPane";
import type { FeatureTabs } from "./types";

vi.mock("./LayoutMenu", () => ({
  LayoutMenu: (): null => null,
}));

const FEATURE_ID = 7;

const leaf: LayoutLeaf = {
  type: "leaf",
  id: ROOT_LEAF_ID,
  tabIds: ["agent", "terminal", "git", "editor"],
  activeTabId: "agent",
};

const tabs: FeatureTabs = {
  agent: { label: "Agent", Icon: BotIcon, content: null },
  terminal: { label: "Terminal", Icon: TerminalIcon, content: null },
  git: { label: "Git", Icon: GitCompareArrowsIcon, content: null },
  editor: { label: "Editor", Icon: CodeIcon, content: null },
};

function resetStores(): void {
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

    expect(useTabHostRegistry.getState().hosts.root).toBeInstanceOf(HTMLDivElement);

    view.unmount();

    expect(useTabHostRegistry.getState().hosts.root).toBeUndefined();
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
});
