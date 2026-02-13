import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProjectList } from "@/components/ProjectList";
import { FeatureList } from "@/components/FeatureList";

export function Sidebar() {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [selectedFeatureId, setSelectedFeatureId] = useState<number | null>(
    null,
  );

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

      <div className="flex-[1] overflow-auto p-2">
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
