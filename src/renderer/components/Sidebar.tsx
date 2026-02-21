import { useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Settings } from "lucide-react";
import logoSvg from "@/logo.svg";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProjectTree } from "@/components/ProjectTree";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { UsageIndicator } from "@/components/UsageIndicator";

export function Sidebar() {
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLElement>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);

  // Detect active project/feature from current route
  const routerState = useRouterState();
  const routeParams = (routerState.location.pathname.match(
    /\/projects\/(\d+)(?:\/features\/(\d+))?/,
  ) ?? []) as string[];
  const activeProjectId = routeParams[1] ? Number(routeParams[1]) : null;
  const activeFeatureId = routeParams[2] ? Number(routeParams[2]) : null;

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
    { enableOnFormTags: true },
  );

  // CMD+OPT+UP: move focus up in the sidebar
  useHotkeys(
    "meta+alt+up",
    (e) => {
      if (getActiveFocusZone() !== "left-sidebar") return;
      e.preventDefault();
      moveFocus("up");
    },
    { enableOnFormTags: true },
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
      } else if (type === "project" && id) {
        // Toggle expand by clicking the project button
        focused.click();
      }
    },
    { enableOnFormTags: false },
  );

  return (
    <aside ref={sidebarRef} className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center justify-between px-4 py-2">
        <img src={logoSvg} alt="ProductDevR" className="size-8" />
        <span className="text-sm font-semibold">ProductDevR</span>
        <div className="flex items-center gap-1 ml-auto">
          <UsageIndicator />
          <Link to="/settings">
          <Button variant="ghost" size="icon" className="size-7">
            <Settings className="size-4" />
            <span className="sr-only">Settings</span>
          </Button>
        </Link>
        </div>
      </div>

      <Separator />

      <div className="flex-1 min-w-0 overflow-hidden p-2">
        <ProjectTree
          activeProjectId={activeProjectId}
          activeFeatureId={effectiveFeatureId}
          onSelectFeature={setSelectedFeatureId}
        />
      </div>
    </aside>
  );
}
