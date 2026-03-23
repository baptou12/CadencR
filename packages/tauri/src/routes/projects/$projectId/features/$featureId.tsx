import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useGetFeature, useListProjects } from "@/api/generated";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = useGetFeature(numericFeatureId);
  const feature = featureQuery.data ?? undefined;

  if (feature?.type === "ws-session") {
    return (
      <WsSessionRedirect
        featureId={numericFeatureId}
        projectId={numericProjectId}
      />
    );
  }

  return (
    <FeatureWorkflowView
      featureId={numericFeatureId}
      projectId={numericProjectId}
      feature={feature}
      featureQuery={featureQuery}
    />
  );
}

// ---------------------------------------------------------------------------
// WS session redirect — navigates to the WS session route
// ---------------------------------------------------------------------------

function WsSessionRedirect({
  featureId,
  projectId,
}: {
  featureId: number;
  projectId: number;
}) {
  const projectsQuery = useListProjects();
  const project = projectsQuery.data?.find((p) => p.id === projectId);

  const wsSessionId = wsSessionIdFromFeature(featureId);

  if (!project) {
    return null; // Loading
  }

  return (
    <Navigate
      to="/ws-session/$sessionId"
      params={{ sessionId: wsSessionId }}
      search={{ cwd: project.path, featureId, projectId }}
      replace
    />
  );
}
