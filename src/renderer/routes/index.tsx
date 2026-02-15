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

  return (
    <div className="p-6">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );
}
