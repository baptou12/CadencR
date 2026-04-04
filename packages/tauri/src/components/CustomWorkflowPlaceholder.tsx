import { Loader2Icon, WorkflowIcon } from "lucide-react";
import { useGetWorkflowDefinition } from "@/api/generated";
import { Badge } from "@/components/ui/badge";
import { FeatureTopBar } from "@/components/FeatureTopBar";

interface CustomWorkflowPlaceholderProps {
  featureId: number;
  projectId: number;
  workflowDefinitionId: number;
}

export function CustomWorkflowPlaceholder({
  featureId,
  projectId,
  workflowDefinitionId,
}: CustomWorkflowPlaceholderProps) {
  const { data: definition, isLoading } = useGetWorkflowDefinition(workflowDefinitionId);

  return (
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} />
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <WorkflowIcon className="size-12 text-muted-foreground" />
          {isLoading ? (
            <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          ) : definition ? (
            <>
              <h2 className="text-lg font-semibold">{definition.name}</h2>
              {definition.description && (
                <p className="text-sm text-muted-foreground">{definition.description}</p>
              )}
              <div className="flex items-center gap-2">
                <Badge variant="outline">{definition.phases.length} phases</Badge>
                {definition.is_preset && <Badge variant="secondary">Preset</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Custom workflow UI coming soon. Phases, artifacts, and gates will be displayed here.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Workflow definition not found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
