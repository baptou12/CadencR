import { describe, expect, it, vi } from "vitest";

import type { BrowserTabMetadata } from "@/lib/desktop-bridge";
import { fireEvent, render, screen } from "@/test-utils";
import { BrowserTabStrip } from "./BrowserTabStrip";
import type { BrowserWorkspaceModel } from "./useBrowserWorkspaceModel";

function tab(index: number, activeIndex: number): BrowserTabMetadata {
  return {
    id: `tab-${index}`,
    title: `Tab ${index}`,
    url: `https://tab-${index}.example/`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: "default",
    isActive: index === activeIndex,
    devToolsOpen: false,
    pinned: false,
    suspended: false,
    zoomPercent: 100,
    responsive: {
      enabled: false,
      preset: "mobile",
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      colorScheme: "system",
      status: "ready",
    },
    scopeId: 1,
  };
}

function model(activeIndex: number): BrowserWorkspaceModel {
  const tabs = Array.from({ length: 25 }, (_, index) => tab(index + 1, activeIndex));
  return {
    state: {
      tabs,
      activeTabId: `tab-${activeIndex}`,
      consoleEntries: [],
      networkEntries: [],
      knownOrigins: [],
      error: null,
    },
    pendingAction: null,
    defaultMode: "normal",
    creatingMode: null,
    newTab: vi.fn(async () => undefined),
    activateTab: vi.fn(),
    closeTab: vi.fn(),
    setTabPinned: vi.fn(),
    duplicateTab: vi.fn(),
    reorderTab: vi.fn(),
    closeOtherTabs: vi.fn(),
    reopenLastClosedTab: vi.fn(),
  } as unknown as BrowserWorkspaceModel;
}

describe("BrowserTabStrip", () => {
  it("keeps creation controls outside the hidden-scrollbar tab rail and reveals the active tab", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<BrowserTabStrip model={model(25)} />);

    const activePill = screen.getByText("Tab 25").closest<HTMLElement>("[aria-current='page']");
    const tabRail = activePill?.parentElement;
    const newTabButton = screen.getByRole("button", { name: /New browser tab/ });
    expect(tabRail).not.toBeNull();
    expect(tabRail?.contains(newTabButton)).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });

    Object.defineProperty(tabRail, "scrollWidth", { configurable: true, value: 1_000 });
    Object.defineProperty(tabRail, "clientWidth", { configurable: true, value: 300 });
    fireEvent.wheel(tabRail as HTMLElement, { deltaX: 0, deltaY: 40 });
    expect(tabRail?.scrollLeft).toBe(40);
  });
});
