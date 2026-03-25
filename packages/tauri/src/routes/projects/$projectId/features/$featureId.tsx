import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useGetFeature, useListProjects } from "@/api/generated";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { useSaveLastOpenedFeature } from "@/hooks/useSaveLastOpenedFeature";
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

  // Save last-opened feature only for non-ws-session types;
  // ws-session features save from their own route after redirect.
  const isWsSession = feature?.type === "ws-session";
  useSaveLastOpenedFeature(numericProjectId, numericFeatureId, isWsSession);

  if (isWsSession) {
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
