import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, GitFork, Pencil, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { WorkflowPhasePreview } from "@/components/workflow/WorkflowPhasePreview";
import { WorkflowEditor } from "@/components/workflow/WorkflowEditor";
import type { WorkflowDefinition } from "@/api/generated";
import {
  useListWorkflowDefinitions,
  useDeleteWorkflowDefinition,
  getListWorkflowDefinitionsQueryKey,
} from "@/api/generated";

export const Route = createFileRoute("/workflows")({
  component: WorkflowsPage,
});

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; definitionId: number }
  | { mode: "fork"; forkFromId: number }
  | { mode: "view"; definitionId: number };

function WorkflowsPage() {
  const { data: definitions, isLoading } = useListWorkflowDefinitions();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDefinition | null>(null);

  const deleteMutation = useDeleteWorkflowDefinition({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getListWorkflowDefinitionsQueryKey() });
      toast.success("Workflow deleted");
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        toast.error("Cannot delete — this workflow is used by active features");
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to delete workflow");
      }
      setDeleteTarget(null);
    },
  });

  const handleEditorSave = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListWorkflowDefinitionsQueryKey() });
    setEditor({ mode: "closed" });
  }, [queryClient]);

  const handleEditorCancel = useCallback(() => {
    setEditor({ mode: "closed" });
  }, []);

  if (editor.mode !== "closed") {
    return (
      <div className="h-full">
        <WorkflowEditor
          definitionId={editor.mode === "edit" ? editor.definitionId : editor.mode === "view" ? editor.definitionId : undefined}
          forkFromId={editor.mode === "fork" ? editor.forkFromId : undefined}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
        />
      </div>
    );
  }

  const presets = definitions?.filter((d) => d.is_preset) ?? [];
  const custom = definitions?.filter((d) => !d.is_preset) ?? [];

  return (
    <div className="h-full overflow-y-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workflow Library</h1>
        <Button onClick={() => setEditor({ mode: "create" })}>
          <Plus className="size-4 mr-1.5" />
          Create Custom Workflow
        </Button>
      </div>

      {isLoading ? (
        <LoadingSkeletons />
      ) : (
        <>
          <Section title="Built-in Presets">
            {presets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No presets available.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {presets.map((def) => (
                  <PresetCard
                    key={def.id}
                    definition={def}
                    onFork={() => setEditor({ mode: "fork", forkFromId: def.id })}
                    onView={() => setEditor({ mode: "view", definitionId: def.id })}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section title="Custom Workflows">
            {custom.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No custom workflows yet. Create one or fork a preset.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {custom.map((def) => (
                  <CustomCard
                    key={def.id}
                    definition={def}
                    onEdit={() => setEditor({ mode: "edit", definitionId: def.id })}
                    onFork={() => setEditor({ mode: "fork", forkFromId: def.id })}
                    onDelete={() => setDeleteTarget(def)}
                  />
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete workflow"
        description={`Delete "${deleteTarget?.name ?? ""}"? This cannot be undone.`}
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

interface PresetCardProps {
  definition: WorkflowDefinition;
  onFork: () => void;
  onView: () => void;
}

function PresetCard({ definition, onFork, onView }: PresetCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-medium">{definition.name}</h3>
        {definition.description && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{definition.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{definition.phases.length} phases</p>
      </div>
      <WorkflowPhasePreview phases={definition.phases} />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onView}>
          <Eye className="size-3.5 mr-1" />
          View Details
        </Button>
        <Button size="sm" onClick={onFork}>
          <GitFork className="size-3.5 mr-1" />
          Fork & Customize
        </Button>
      </div>
    </div>
  );
}

interface CustomCardProps {
  definition: WorkflowDefinition;
  onEdit: () => void;
  onFork: () => void;
  onDelete: () => void;
}

function CustomCard({ definition, onEdit, onFork, onDelete }: CustomCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <h3 className="font-medium">{definition.name}</h3>
        {definition.description && (
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{definition.description}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
          <span>{definition.phases.length} phases</span>
          <span>·</span>
          <span>{new Date(definition.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <WorkflowPhasePreview phases={definition.phases} />
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil className="size-3.5 mr-1" />
          Edit
        </Button>
        <Button size="sm" variant="outline" onClick={onFork}>
          <GitFork className="size-3.5 mr-1" />
          Fork
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <Trash2 className="size-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function LoadingSkeletons() {
  return (
    <div className="space-y-8">
      {[0, 1].map((section) => (
        <div key={section} className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-border p-4 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-8 w-40" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
