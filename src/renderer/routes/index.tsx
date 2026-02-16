import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { trpc } from "../trpc";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const projectsQuery = trpc.projects.list.useQuery();
  const firstProjectId = projectsQuery.data?.[0]?.id ?? null;

  const featuresQuery = trpc.features.listByProject.useQuery(
    { project_id: firstProjectId! },
    { enabled: firstProjectId != null },
  );
  const firstFeatureId = featuresQuery.data?.[0]?.id ?? null;

  useEffect(() => {
    if (firstProjectId != null && firstFeatureId != null) {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(firstProjectId),
          featureId: String(firstFeatureId),
        },
        replace: true,
      });
    }
  }, [firstProjectId, firstFeatureId, navigate]);

  // Show helpful message if project exists but has no features
  if (projectsQuery.isSuccess && firstProjectId != null && featuresQuery.isSuccess && firstFeatureId == null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted-foreground">No features in this project yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Use the + button in the sidebar to create a new feature</p>
        </div>
      </div>
    );
  }

  // Show message if no projects exist
  if (projectsQuery.isSuccess && firstProjectId == null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="text-center">
          <p className="text-muted-foreground">No projects yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Use the + button in the sidebar to add a project</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}
