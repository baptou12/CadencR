import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useGetFeature, useListProjects } from "@/api/generated";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";

interface FeatureSearch {
  initialDescription?: string;
  useWorktree?: boolean;
}

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
  validateSearch: (search: Record<string, unknown>): FeatureSearch => ({
    initialDescription: typeof search.initialDescription === "string" ? search.initialDescription : undefined,
    useWorktree: typeof search.useWorktree === "boolean" ? search.useWorktree : undefined,
  }),
});

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const { initialDescription, useWorktree } = Route.useSearch();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = useGetFeature(numericFeatureId);
  const feature = featureQuery.data ?? undefined;

  // Both FeatureWorkflowView and ws-session route handle saving
  // last-opened feature with activeTab, so skip here.
  const isWsSession = feature?.type === "ws-session";

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
      initialDescription={initialDescription}
      initialUseWorktree={useWorktree}
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
