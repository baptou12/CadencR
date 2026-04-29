import { useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Settings, PanelLeftClose } from "lucide-react";
import logoSvg from "@/logo.svg";
import { Button } from "@/components/ui/button";
import { ProjectTree } from "@/components/ProjectTree";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { APP_VERSION } from "@/lib/app-version";
import { startDragging, toggleMaximize } from "@/lib/window-drag";
import { useSidebarCollapsed } from "@/components/SidebarContext";

export function Sidebar() {
  const { setCollapsed } = useSidebarCollapsed();
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLElement>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);

  // Detect active project/feature from current route
  const routerState = useRouterState();
  const routeParams = (routerState.location.pathname.match(
    /\/projects\/(\d+)(?:\/features\/(\d+))?/,
  ) ?? []) as string[];
  const activeProjectId = routeParams[1]
    ? Number(routeParams[1])
    : routerState.location.search?.projectId
      ? Number(routerState.location.search.projectId)
      : null;
  const activeFeatureId = routeParams[2]
    ? Number(routeParams[2])
    : routerState.location.search?.featureId
      ? Number(routerState.location.search.featureId)
      : null;

  const effectiveFeatureId = activeFeatureId ?? selectedFeatureId;

  const getNavItems = () => {
    if (!sidebarRef.current) return [];
    return Array.from(sidebarRef.current.querySelectorAll("[data-nav-item]")) as HTMLElement[];
  };

  const moveFocus = (direction: "up" | "down") => {
    const items = getNavItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((el) => el === document.activeElement);
    let nextIndex: number;
    if (currentIndex === -1) {
      nextIndex = direction === "down" ? 0 : items.length - 1;
    } else if (direction === "down") {
      nextIndex = currentIndex >= items.length - 1 ? 0 : currentIndex + 1;
    } else {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    }
    items[nextIndex].focus({ focusVisible: true } as FocusOptions);
  };

  // CMD+OPT+DOWN: move focus down in the sidebar
  useHotkeys(
    "meta+alt+down",
    (e) => {
      if (getActiveFocusZone() !== "left-sidebar") return;
      e.preventDefault();
      moveFocus("down");
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+OPT+UP: move focus up in the sidebar
  useHotkeys(
    "meta+alt+up",
    (e) => {
      if (getActiveFocusZone() !== "left-sidebar") return;
      e.preventDefault();
      moveFocus("up");
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // Enter: navigate to the focused item
  useHotkeys(
    "enter",
    (e) => {
      if (getActiveFocusZone() !== "left-sidebar") return;
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.hasAttribute("data-nav-item")) return;
      e.preventDefault();

      const type = focused.getAttribute("data-nav-type");
      const id = focused.getAttribute("data-nav-id");
      const projectId = focused.getAttribute("data-nav-project-id");

      if (type === "feature" && id && projectId) {
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: { projectId, featureId: id },
        });
        requestAnimationFrame(() => {
          window.dispatchEvent(new CustomEvent("cadencr:focus-prompt"));
        });
      } else if (type === "project" && id) {
        // Toggle expand by clicking the project button
        focused.click();
      }
    },
    { enableOnFormTags: false },
  );

  return (
    <aside ref={sidebarRef} className="flex h-full flex-col bg-sidebar">
      <div
        className="group relative h-16"
        onMouseDown={startDragging}
        onDoubleClick={toggleMaximize}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <img src={logoSvg} alt="Cadencr" className="size-11 mr-2 shrink-0 -translate-y-px" />
          <span
            className="text-2xl font-bold uppercase tracking-widest leading-none"
            style={{
              fontFamily: "'Avenir Next', 'Montserrat', 'Helvetica Neue', sans-serif",
            }}
          >
            Cadencr
          </span>
          {import.meta.env.DEV ? (
            <span className="ml-2 self-start mt-2 text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded bg-orange-500/20 text-orange-400 leading-none">
              dev
            </span>
          ) : (
            <span className="ml-2 self-start mt-2 text-[9px] font-semibold uppercase tracking-wider px-1 py-px rounded bg-white/20 text-white leading-none">
              beta
            </span>
          )}
        </div>
        <div className="absolute right-4 inset-y-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Collapse sidebar (⌘B)"
            onClick={() => setCollapsed(true)}
          >
            <PanelLeftClose className="size-4" />
            <span className="sr-only">Collapse sidebar</span>
          </Button>
        </div>
      </div>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden p-2">
        <ProjectTree
          activeProjectId={activeProjectId}
          activeFeatureId={effectiveFeatureId}
          onSelectFeature={setSelectedFeatureId}
        />
      </div>

      <Link
        to="/settings"
        data-nav-item
        className="flex items-center justify-between gap-2 px-3 py-2 text-xs border-t border-border/40 text-foreground/80 hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:bg-accent"
      >
        <span className="flex items-center gap-2">
          <Settings className="size-4" />
          <span>Settings</span>
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">v{APP_VERSION}</span>
      </Link>
    </aside>
  );
}
