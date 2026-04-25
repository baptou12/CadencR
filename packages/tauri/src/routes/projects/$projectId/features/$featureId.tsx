import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { isAxiosError } from "axios";
import { useGetFeature, useListProjects } from "@/api/generated";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";

interface FeatureSearch {
  initialDescription?: string;
  useWorktree?: boolean;
}

export const Route = createFileRoute("/projects/$projectId/features/$featureId")({
  component: FeaturePage,
  validateSearch: (search: Record<string, unknown>): FeatureSearch => ({
    initialDescription:
      typeof search.initialDescription === "string" ? search.initialDescription : undefined,
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
    return <WsSessionRedirect featureId={numericFeatureId} projectId={numericProjectId} />;
  }

  // The backend now returns 404 when a feature has been deleted (instead of
  // `200 null`). Surface that explicitly so we never mount the workflow view
  // with `feature === undefined` after a confirmed-missing response — the
  // older behaviour produced a partially-broken UI keyed on a phantom id.
  if (featureQuery.isError) {
    if (isAxiosError(featureQuery.error) && featureQuery.error.response?.status === 404) {
      return <FeatureNotFound featureId={numericFeatureId} />;
    }
    return <FeatureLoadError error={featureQuery.error} onRetry={() => featureQuery.refetch()} />;
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

function FeatureNotFound({ featureId }: { featureId: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium">Feature #{featureId} not found</p>
      <p className="text-sm text-muted-foreground">It may have been deleted from another window.</p>
      <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
        Back to home
      </Link>
    </div>
  );
}

function FeatureLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : "Failed to load feature";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Retry
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WS session redirect — navigates to the WS session route
// ---------------------------------------------------------------------------

function WsSessionRedirect({ featureId, projectId }: { featureId: number; projectId: number }) {
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
