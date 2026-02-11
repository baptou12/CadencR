import { createFileRoute } from "@tanstack/react-router";
import { FeatureTopBar } from "@/components/FeatureTopBar";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

function FeaturePage() {
  const { featureId } = Route.useParams();
  const numericFeatureId = Number(featureId);

  return (
    <div className="flex h-full flex-col -m-6">
      <FeatureTopBar featureId={numericFeatureId} />
      <div className="flex-1 p-6">
        <p className="text-muted-foreground">
          Feature workspace will appear here.
        </p>
      </div>
    </div>
  );
}
