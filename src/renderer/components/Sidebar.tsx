import { useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProjectList } from "@/components/ProjectList";
import { FeatureList } from "@/components/FeatureList";

function isSidebarFocused() {
  const zone = document.querySelector('[data-focus-zone="left-sidebar"]');
  return zone && (zone === document.activeElement || zone.contains(document.activeElement));
}

export function Sidebar() {
  const navigate = useNavigate();
  const sidebarRef = useRef<HTMLElement>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(null);

  // Detect active project/feature from current route
  const routerState = useRouterState();
  const routeParams = (routerState.location.pathname.match(
    /\/projects\/(\d+)(?:\/features\/(\d+))?/,
  ) ?? []) as string[];
  const activeProjectId = routeParams[1] ? Number(routeParams[1]) : null;
  const activeFeatureId = routeParams[2] ? Number(routeParams[2]) : null;

  // Sync sidebar selection with route
  const effectiveProjectId = activeProjectId ?? selectedProjectId;
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
      if (!isSidebarFocused()) return;
      e.preventDefault();
      moveFocus("down");
    },
    { enableOnFormTags: true },
  );

  // CMD+OPT+UP: move focus up in the sidebar
  useHotkeys(
    "meta+alt+up",
    (e) => {
      if (!isSidebarFocused()) return;
      e.preventDefault();
      moveFocus("up");
    },
    { enableOnFormTags: true },
  );

  // Enter: navigate to the focused item
  useHotkeys(
    "enter",
    (e) => {
      if (!isSidebarFocused()) return;
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
      }
      // For projects, just focusing is enough — the project is already "selected" visually
    },
    { enableOnFormTags: false },
  );

  return (
    <aside ref={sidebarRef} className="flex h-full flex-col bg-sidebar">
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-sm font-semibold">ProductDevR</span>
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="size-7">
            <Settings className="size-4" />
            <span className="sr-only">Settings</span>
          </Button>
        </Link>
      </div>

      <Separator />

      <div className="shrink-0 p-2">
        <ProjectList
          selectedProjectId={effectiveProjectId}
          onSelectProject={setSelectedProjectId}
        />
      </div>

      <Separator />

      <div className="flex-[2] overflow-auto p-2">
        {effectiveProjectId !== null ? (
          <FeatureList
            projectId={effectiveProjectId}
            selectedFeatureId={effectiveFeatureId ?? undefined}
            onSelectFeature={setSelectedFeatureId}
          />
        ) : (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            Select a project to see features
          </p>
        )}
      </div>
    </aside>
  );
}
