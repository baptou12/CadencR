import { createFileRoute } from "@tanstack/react-router";
import { trpc } from "@/trpc";
import { SessionView } from "@/components/SessionView";
import { FeatureWorkflowView } from "@/components/FeatureWorkflowView";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = trpc.features.getById.useQuery({
    id: numericFeatureId,
  });
  const feature = featureQuery.data;

  if (feature?.type === "session") {
    return (
      <SessionView
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
