import { useState, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WorkflowDefinition, WorkflowPhase } from "@/api/generated";
import {
  useGetWorkflowDefinition,
  useCreateWorkflowDefinition,
  useUpdateWorkflowDefinition,
  useForkWorkflowDefinition,
  useCreateWorkflowPhase,
  useUpdateWorkflowPhase,
  useDeleteWorkflowPhase,
  useReorderWorkflowPhases,
  getGetWorkflowDefinitionQueryKey,
  getListWorkflowDefinitionsQueryKey,
} from "@/api/generated";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type TemplateTab = "system" | "command" | "artifact";

interface UseWorkflowEditorOptions {
  definitionId?: number;
  forkFromId?: number;
  onSave: (definition: WorkflowDefinition) => void;
}

export function useWorkflowEditor({ definitionId, forkFromId, onSave }: UseWorkflowEditorOptions) {
  const queryClient = useQueryClient();

  const sourceId = definitionId ?? forkFromId;
  const { data: sourceDefinition, isLoading } = useGetWorkflowDefinition(sourceId ?? 0, {
    enabled: sourceId != null && sourceId > 0,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateTab>("system");
  const [initialized, setInitialized] = useState(false);

  // Sync from loaded definition once
  if (sourceDefinition && !initialized) {
    setName(forkFromId ? `${sourceDefinition.name} (Custom)` : sourceDefinition.name);
    setDescription(sourceDefinition.description ?? "");
    setSlug(forkFromId ? slugify(`${sourceDefinition.name}-custom`) : sourceDefinition.slug);
    setInitialized(true);
  }

  const isPreset = sourceDefinition?.is_preset === true && !forkFromId;
  const isEditing = definitionId != null;

  const handleNameChange = useCallback((newName: string) => {
    setName(newName);
    if (!slugManual) setSlug(slugify(newName));
  }, [slugManual]);

  const handleSlugChange = useCallback((newSlug: string) => {
    setSlugManual(true);
    setSlug(newSlug);
  }, []);

  // Mutations
  const createDef = useCreateWorkflowDefinition();
  const updateDef = useUpdateWorkflowDefinition();
  const forkDef = useForkWorkflowDefinition();
  const createPhase = useCreateWorkflowPhase();
  const updatePhase = useUpdateWorkflowPhase();
  const deletePhase = useDeleteWorkflowPhase();
  const reorderPhases = useReorderWorkflowPhases();

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getListWorkflowDefinitionsQueryKey() });
    if (definitionId) {
      void queryClient.invalidateQueries({ queryKey: getGetWorkflowDefinitionQueryKey(definitionId) });
    }
  }, [queryClient, definitionId]);

  const phases = useMemo(() => {
    if (!sourceDefinition) return [];
    return [...sourceDefinition.phases].sort((a, b) => a.order_index - b.order_index);
  }, [sourceDefinition]);

  const selectedPhase = useMemo(
    () => phases.find((p) => p.id === selectedPhaseId) ?? null,
    [phases, selectedPhaseId],
  );

  const isMutating =
    createDef.isLoading || updateDef.isLoading || forkDef.isLoading ||
    createPhase.isLoading || updatePhase.isLoading || deletePhase.isLoading ||
    reorderPhases.isLoading;

  const handleSave = useCallback(async () => {
    try {
      if (forkFromId && sourceDefinition) {
        const forked = await forkDef.mutateAsync({ id: forkFromId, name, slug });
        invalidate();
        onSave(forked);
      } else if (isEditing && definitionId) {
        const updated = await updateDef.mutateAsync({
          id: definitionId,
          data: { name, slug, description: description || undefined },
        });
        invalidate();
        onSave(updated);
      } else {
        const created = await createDef.mutateAsync({
          name,
          slug,
          description: description || undefined,
          phases: [],
        });
        invalidate();
        onSave(created);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save workflow");
    }
  }, [name, slug, description, forkFromId, isEditing, definitionId, sourceDefinition, forkDef, updateDef, createDef, invalidate, onSave]);

  const handleAddPhase = useCallback(async () => {
    if (!definitionId) return;
    const order = phases.length;
    const phaseName = `Phase ${order + 1}`;
    try {
      const created = await createPhase.mutateAsync({
        definitionId,
        phase: {
          name: phaseName,
          slug: slugify(phaseName),
          order_index: order,
          gate_type: "auto",
          system_prompt_template: "",
          command_prompt_template: "",
          artifact_template: "",
          input_phase_slugs: [],
          model_override: "",
          agent_type: "workflow",
        },
      });
      invalidate();
      setSelectedPhaseId(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add phase");
    }
  }, [definitionId, phases.length, createPhase, invalidate]);

  const handleUpdatePhase = useCallback(async (
    phaseId: number,
    updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>,
  ) => {
    if (!definitionId) return;
    try {
      await updatePhase.mutateAsync({ definitionId, phaseId, phase: updates });
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update phase");
    }
  }, [definitionId, updatePhase, invalidate]);

  const handleDeletePhase = useCallback(async (phaseId: number) => {
    if (!definitionId) return;
    try {
      await deletePhase.mutateAsync({ definitionId, phaseId });
      invalidate();
      if (selectedPhaseId === phaseId) setSelectedPhaseId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete phase");
    }
  }, [definitionId, deletePhase, invalidate, selectedPhaseId]);

  const handleReorder = useCallback(async (phaseIds: number[]) => {
    if (!definitionId) return;
    try {
      await reorderPhases.mutateAsync({ definitionId, phase_ids: phaseIds });
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder phases");
    }
  }, [definitionId, reorderPhases, invalidate]);

  return {
    // State
    name, description, slug, isPreset, isEditing, isLoading, isMutating,
    phases, selectedPhaseId, selectedPhase, activeTab,
    // Setters
    handleNameChange, handleSlugChange, setDescription,
    setSelectedPhaseId, setActiveTab,
    // Actions
    handleSave, handleAddPhase, handleUpdatePhase, handleDeletePhase, handleReorder,
    slugify,
  };
}
