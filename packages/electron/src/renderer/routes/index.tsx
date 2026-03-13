import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { trpc } from "../trpc";
import { useListProjects } from "../api/generated";

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: (search: Record<string, unknown>): { projectId?: number } => {
    const result: { projectId?: number } = {};
    if (search.projectId) result.projectId = Number(search.projectId);
    return result;
  },
});

function HomePage() {
  const navigate = useNavigate();
  const { projectId: searchProjectId } = Route.useSearch();
  const projectsQuery = useListProjects();
  const fallbackProjectId = projectsQuery.data?.[0]?.id ?? null;
  const targetProjectId = searchProjectId ?? fallbackProjectId;

  const featuresQuery = trpc.features.listByProject.useQuery(
    { project_id: targetProjectId! },
    { enabled: targetProjectId != null },
  );
  const firstFeatureId = featuresQuery.data?.[0]?.id ?? null;

  useEffect(() => {
    if (targetProjectId != null && firstFeatureId != null) {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(targetProjectId),
          featureId: String(firstFeatureId),
        },
        replace: true,
      });
    }
  }, [targetProjectId, firstFeatureId, navigate]);

  // Show helpful message if project exists but has no features
  if (projectsQuery.isSuccess && targetProjectId != null && featuresQuery.isSuccess && firstFeatureId == null) {
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
  if (projectsQuery.isSuccess && targetProjectId == null) {
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
