import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProjectList } from "@/components/ProjectList";
import { FeatureList } from "@/components/FeatureList";
import { useFocusContext } from "@/contexts/FocusContext";
import { trpc } from "@/trpc";

type NavItem =
  | { type: "project"; id: number }
  | { type: "feature"; id: number; projectId: number };

export function Sidebar() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(
    null,
  );
  const [keyboardFocusIndex, setKeyboardFocusIndex] = useState<number | null>(
    null,
  );

  const navigate = useNavigate();
  const { focusZone } = useFocusContext();

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

  // Fetch projects at sidebar level for keyboard navigation
  const projectsQuery = trpc.projects.list.useQuery();
  const projectsData = projectsQuery.data;

  // Fetch features for the effective project
  const featuresQuery = trpc.features.listByProject.useQuery(
    { project_id: effectiveProjectId! },
    { enabled: effectiveProjectId !== null },
  );
  const featuresData = featuresQuery.data;

  // Build flat navigation list: projects with their features interleaved
  const navItems: NavItem[] = useMemo(() => {
    const projects = projectsData ?? [];
    const features = featuresData ?? [];
    const items: NavItem[] = [];
    for (const project of projects) {
      items.push({ type: "project", id: project.id });
      // Only include features for the currently selected project
      if (project.id === effectiveProjectId) {
        for (const feature of features) {
          items.push({
            type: "feature",
            id: feature.id,
            projectId: project.id,
          });
        }
      }
    }
    return items;
  }, [projectsData, featuresData, effectiveProjectId]);

  // Determine keyboard focus item for passing to children
  const keyboardFocusItem =
    keyboardFocusIndex !== null && keyboardFocusIndex < navItems.length
      ? navItems[keyboardFocusIndex]
      : null;

  const keyboardFocusProjectId =
    keyboardFocusItem?.type === "project" ? keyboardFocusItem.id : null;
  const keyboardFocusFeatureId =
    keyboardFocusItem?.type === "feature" ? keyboardFocusItem.id : null;

  const navigateToItem = useCallback(
    (item: NavItem) => {
      if (item.type === "project") {
        setSelectedProjectId(item.id);
        setSelectedFeatureId(null);
        // No dedicated project route exists, selecting project updates sidebar
      } else {
        setSelectedProjectId(item.projectId);
        setSelectedFeatureId(item.id);
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(item.projectId),
            featureId: String(item.id),
          },
        });
      }
    },
    [navigate],
  );

  // CMD+DOWN: move selection down in the sidebar
  useHotkeys(
    "meta+down",
    (e) => {
      e.preventDefault();
      if (navItems.length === 0) return;

      setKeyboardFocusIndex((prev) => {
        let nextIndex: number;
        if (prev === null) {
          nextIndex = 0;
        } else if (prev >= navItems.length - 1) {
          // Wrap to top
          nextIndex = 0;
        } else {
          nextIndex = prev + 1;
        }
        navigateToItem(navItems[nextIndex]);
        return nextIndex;
      });
    },
    {
      enabled: focusZone === "left-sidebar",
      enableOnFormTags: false,
    },
    [navItems, focusZone, navigateToItem],
  );

  // CMD+UP: move selection up in the sidebar
  useHotkeys(
    "meta+up",
    (e) => {
      e.preventDefault();
      if (navItems.length === 0) return;

      setKeyboardFocusIndex((prev) => {
        let nextIndex: number;
        if (prev === null) {
          nextIndex = navItems.length - 1;
        } else if (prev <= 0) {
          // Wrap to bottom
          nextIndex = navItems.length - 1;
        } else {
          nextIndex = prev - 1;
        }
        navigateToItem(navItems[nextIndex]);
        return nextIndex;
      });
    },
    {
      enabled: focusZone === "left-sidebar",
      enableOnFormTags: false,
    },
    [navItems, focusZone, navigateToItem],
  );

  return (
    <aside className="flex h-full flex-col bg-sidebar">
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
          keyboardFocusProjectId={keyboardFocusProjectId}
        />
      </div>

      <Separator />

      <div className="flex-[2] overflow-auto p-2">
        {effectiveProjectId !== null ? (
          <FeatureList
            projectId={effectiveProjectId}
            selectedFeatureId={effectiveFeatureId ?? undefined}
            onSelectFeature={setSelectedFeatureId}
            keyboardFocusFeatureId={keyboardFocusFeatureId}
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
