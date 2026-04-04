import { useState, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PresetPicker } from "@/components/workflow/PresetPicker";
import { useCreateFeature } from "@/api/generated";

export const Route = createFileRoute("/projects/$projectId/new-workflow")({
  component: NewWorkflowPage,
});

function NewWorkflowPage() {
  const { projectId } = Route.useParams();
  const numericProjectId = Number(projectId);
  const navigate = useNavigate();

  const [selectedDefinitionId, setSelectedDefinitionId] = useState<number | null>(null);
  const [title, setTitle] = useState("");

  const createFeature = useCreateFeature({
    onSuccess: (feature) => {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId, featureId: String(feature.id) },
      });
    },
  });

  const handleBack = useCallback(() => {
    if (selectedDefinitionId !== null) {
      setSelectedDefinitionId(null);
    } else {
      void navigate({ to: "/" });
    }
  }, [selectedDefinitionId, navigate]);

  const handleStart = useCallback(() => {
    if (!title.trim()) return;
    createFeature.mutate({
      project_id: numericProjectId,
      title: title.trim(),
      type: "ws-feature",
      workflow_definition_id: selectedDefinitionId,
    });
  }, [numericProjectId, title, selectedDefinitionId, createFeature]);

  // Step 1: Pick a workflow
  if (selectedDefinitionId === null) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-bold">Choose a Workflow</h1>
        </div>
        <PresetPicker onSelect={setSelectedDefinitionId} selectedId={null} />
      </div>
    );
  }

  // Step 2: Title + description form
  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={handleBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-2xl font-bold">Start Workflow</h1>
      </div>

      <div className="max-w-lg space-y-4">
        <div className="space-y-2">
          <label htmlFor="wf-title" className="text-sm font-medium">
            Feature Title
          </label>
          <Input
            id="wf-title"
            placeholder="e.g. Add user authentication"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <Button
          onClick={handleStart}
          disabled={!title.trim() || createFeature.isLoading}
        >
          <Play className="size-4 mr-1.5" />
          {createFeature.isLoading ? "Starting..." : "Start Workflow"}
        </Button>
      </div>
    </div>
  );
}
