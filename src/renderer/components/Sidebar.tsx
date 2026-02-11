import { useState } from "react";
import { Link } from "@tanstack/react-router";
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

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-muted/50">
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
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />
      </div>

      <Separator />

      <div className="flex-[2] overflow-auto p-2">
        {selectedProjectId !== null ? (
          <FeatureList
            projectId={selectedProjectId}
            selectedFeatureId={selectedFeatureId ?? undefined}
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
