import { type ReactNode, type RefObject } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Sidebar } from "@/components/Sidebar";
import { MobileDrawer } from "@/components/MobileDrawer";
import { cn } from "@/lib/utils";

interface AppShellProps {
  isMobile: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  onSearch: () => void;
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>;
  leftSidebarRef: RefObject<HTMLDivElement | null>;
  defaultLeftSize: string;
  onLayoutChanged: () => void;
  children: ReactNode;
}

/**
 * The sidebar + main split. Desktop renders a resizable two-panel layout;
 * mobile renders the main content full-bleed with the sidebar as an
 * off-canvas drawer (collapsed = closed) so a 390px viewport isn't eaten by a
 * 200px+ rail. Both paths drive the same `collapsed`/`setCollapsed` contract
 * from `SidebarContext`, so the topbar's expand button doubles as the mobile
 * drawer trigger.
 *
 * Mobile heights flow from the `--app-vh` variable (`index.css`), which is
 * `dvh` in a browser but `lvh` in an iOS standalone app — see that file for
 * why. The sidebar rides in a `MobileDrawer`, positioned `absolute` within this
 * `relative` shell (see that component for the iOS-standalone rationale).
 */
export function AppShell({
  isMobile,
  collapsed,
  setCollapsed,
  onSearch,
  sidebarPanelRef,
  leftSidebarRef,
  defaultLeftSize,
  onLayoutChanged,
  children,
}: AppShellProps): ReactNode {
  if (isMobile) {
    return (
      <div className="relative flex h-[var(--app-vh)] w-full overflow-hidden">
        <main
          data-focus-zone="main-content"
          className="h-full w-full min-w-0 overflow-hidden outline-none pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
        >
          {children}
        </main>
        <MobileDrawer
          collapsed={collapsed}
          onClose={() => setCollapsed(true)}
          closeLabel="Close menu"
          panelClassName="pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
        >
          <Sidebar onSearch={onSearch} />
        </MobileDrawer>
      </div>
    );
  }

  return (
    <ResizablePanelGroup orientation="horizontal" onLayoutChanged={onLayoutChanged}>
      <ResizablePanel
        id="sidebar"
        panelRef={sidebarPanelRef}
        collapsible
        collapsedSize={0}
        defaultSize={defaultLeftSize}
        minSize="200px"
        maxSize="400px"
      >
        <div
          ref={leftSidebarRef}
          data-focus-zone="left-sidebar"
          tabIndex={0}
          className="h-full outline-none"
          onFocus={(e) => {
            if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
              const firstItem = e.currentTarget.querySelector(
                "[data-nav-item]",
              ) as HTMLElement | null;
              if (firstItem) firstItem.focus();
            }
          }}
        >
          <Sidebar onSearch={onSearch} />
        </div>
      </ResizablePanel>
      <ResizableHandle
        className={cn("cursor-col-resize", collapsed && "pointer-events-none opacity-0")}
      />
      <ResizablePanel id="main">
        <main
          data-focus-zone="main-content"
          tabIndex={0}
          className="h-full overflow-hidden outline-none"
          onFocus={(e) => {
            if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
              const firstItem = e.currentTarget.querySelector(
                "[data-nav-item]",
              ) as HTMLElement | null;
              if (firstItem) {
                firstItem.focus();
              } else {
                const textarea = e.currentTarget.querySelector("textarea") as HTMLElement | null;
                if (textarea) textarea.focus();
              }
            }
          }}
        >
          {children}
        </main>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
