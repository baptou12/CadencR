import { createRef, type ReactNode } from "react";
import type { GroupProps, PanelImperativeHandle, PanelProps } from "react-resizable-panels";
import { render, act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests guard the regression where dragging the editor's *own* sidebar
 * would re-expand a collapsed *global* sidebar (and double the app logo).
 *
 * Mechanism: every resize handle in the app shares one global "is a drag in
 * progress?" flag (`resize-coordinator`). The editor sidebar pushes that flag
 * to freeze its heavy children while dragging. The global sidebar reads the
 * same flag to compute `collapsible` on its react-resizable-panels panel — and
 * a panel sitting at `collapsedSize={0}` gets force-expanded the moment it
 * becomes non-collapsible. So a *foreign* drag must never flip `collapsible`
 * off while the global sidebar is collapsed.
 *
 * We mock `ui/resizable` to record the props handed to the sidebar panel, then
 * drive the *real* `resize-coordinator` (via `pushResize`) to simulate the
 * editor sidebar's drag — exactly the path that triggered the bug.
 */

interface AppShellGroupProps extends GroupProps {
  "data-app-shell-resize"?: string;
}

const appShellGroupProps: AppShellGroupProps[] = [];
const sidebarPanelProps: PanelProps[] = [];

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: (props: AppShellGroupProps) => {
    appShellGroupProps.push(props);
    return <div>{props.children}</div>;
  },
  ResizablePanel: (props: PanelProps) => {
    if (props.id === "sidebar") sidebarPanelProps.push(props);
    return <div data-testid={`panel-${props.id}`}>{props.children}</div>;
  },
  ResizableHandle: () => <div data-testid="handle" />,
}));

vi.mock("@/components/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar-content" />,
}));

vi.mock("@/components/MobileDrawer", () => ({
  MobileDrawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { AppShell } from "./AppShell";
import { isResizing, popResize, pushResize } from "@/lib/resize-coordinator";

function renderShell(collapsed: boolean) {
  return render(
    <AppShell
      isMobile={false}
      collapsed={collapsed}
      setCollapsed={() => {}}
      onSearch={() => {}}
      sidebarPanelRef={createRef<PanelImperativeHandle | null>()}
      leftSidebarRef={createRef<HTMLDivElement | null>()}
      defaultLeftSize="256px"
      onLayoutChanged={() => {}}
    >
      <div>main</div>
    </AppShell>,
  );
}

function latestCollapsible(): boolean | undefined {
  return sidebarPanelProps.at(-1)?.collapsible;
}

describe("AppShell global sidebar collapsible", () => {
  beforeEach(() => {
    appShellGroupProps.length = 0;
    sidebarPanelProps.length = 0;
  });

  afterEach(() => {
    cleanup();
    // Drain the shared coordinator so a leaked drag doesn't bleed into the next
    // test (the flag is a module singleton).
    while (isResizing()) popResize();
  });

  it("keeps a collapsed sidebar collapsible while a foreign resize is in progress", () => {
    renderShell(true);
    // Baseline: no drag → collapsible.
    expect(latestCollapsible()).toBe(true);

    // Simulate the editor sidebar starting a drag: it pushes the shared flag.
    act(() => {
      pushResize();
    });

    // The collapsed global sidebar must stay collapsible so the panel is not
    // force-expanded out from under its `collapsedSize={0}`.
    expect(latestCollapsible()).toBe(true);
  });

  it("still disables collapsible mid-drag when the sidebar is expanded", () => {
    renderShell(false);
    expect(latestCollapsible()).toBe(true);

    // While expanded, dragging must hard-clamp to [minSize, maxSize] instead of
    // snapping shut — so `collapsible` flips off during a drag. This preserves
    // the original behavior and proves the fix is scoped to the collapsed case.
    act(() => {
      pushResize();
    });

    expect(latestCollapsible()).toBe(false);
  });

  it("animates programmatic layout changes but not manual resize drags", () => {
    renderShell(false);
    expect(appShellGroupProps.at(-1)?.["data-app-shell-resize"]).toBe("fluid");

    act(() => {
      pushResize();
    });

    expect(appShellGroupProps.at(-1)?.["data-app-shell-resize"]).toBeUndefined();
  });
});
