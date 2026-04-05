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
import { slugify } from "@/lib/utils";

export type TemplateTab = "settings" | "system" | "command" | "artifact";

interface UseWorkflowEditorOptions {
  definitionId?: number;
  forkFromId?: number;
  onSave: (definition: WorkflowDefinition) => void;
}

export function useWorkflowEditor({ definitionId, forkFromId, onSave }: UseWorkflowEditorOptions) {
  const queryClient = useQueryClient();

  const sourceId = definitionId ?? forkFromId;
  const { data: sourceDefinition, isLoading: isSourceLoading } = useGetWorkflowDefinition(sourceId ?? 0, {
    enabled: sourceId != null && sourceId > 0,
  });
  const isLoading = sourceId != null && sourceId > 0 && isSourceLoading;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [selectedPhaseId, setSelectedPhaseId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateTab>("settings");
  const [initialized, setInitialized] = useState(false);
  // Tracks the id of a definition auto-created during "Add phase" in create mode
  const [autoCreatedId, setAutoCreatedId] = useState<number | null>(null);

  const { data: autoCreatedDefinition } = useGetWorkflowDefinition(autoCreatedId ?? 0, {
    enabled: autoCreatedId != null,
  });

  // Sync from loaded definition once
  if (sourceDefinition && !initialized) {
    setName(forkFromId ? `${sourceDefinition.name} (Custom)` : sourceDefinition.name);
    setDescription(sourceDefinition.description ?? "");
    setSlug(forkFromId ? slugify(`${sourceDefinition.name}-custom`) : sourceDefinition.slug);
    setInitialized(true);
  }

  const activeDefinition = autoCreatedDefinition ?? sourceDefinition;
  const isPreset = activeDefinition?.is_preset === true && !forkFromId;
  const effectiveDefinitionId = definitionId ?? autoCreatedId;
  const isEditing = effectiveDefinitionId != null;

  const handleNameChange = useCallback((newName: string) => {
    setName(newName);
    setSlug(slugify(newName));
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
    if (effectiveDefinitionId) {
      void queryClient.invalidateQueries({ queryKey: getGetWorkflowDefinitionQueryKey(effectiveDefinitionId) });
    }
  }, [queryClient, effectiveDefinitionId]);

  const phases = useMemo(() => {
    if (!activeDefinition) return [];
    return [...activeDefinition.phases].sort((a, b) => a.order_index - b.order_index);
  }, [activeDefinition]);

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
      } else if (isEditing && effectiveDefinitionId) {
        const updated = await updateDef.mutateAsync({
          id: effectiveDefinitionId,
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
  }, [name, slug, description, forkFromId, isEditing, effectiveDefinitionId, sourceDefinition, forkDef, updateDef, createDef, invalidate, onSave]);

  const handleAddPhase = useCallback(async () => {
    const defId = effectiveDefinitionId;
    const order = phases.length;
    const phaseName = `Phase ${order + 1}`;
    const newPhase = {
      name: phaseName,
      slug: slugify(phaseName),
      order_index: order,
      gate_type: "auto" as const,
      system_prompt_template: "",
      command_prompt_template: "",
      artifact_template: "",
      input_phase_slugs: [],
      model_override: "",
      agent_type: "workflow" as const,
      artifact_types: [],
    };

    // In create mode, auto-save the definition with the first phase included (backend requires ≥1 phase)
    if (!defId) {
      if (!name.trim()) {
        toast.error("Please enter a workflow name before adding phases");
        return;
      }
      try {
        const created = await createDef.mutateAsync({
          name,
          slug: slug || slugify(name),
          description: description || undefined,
          phases: [newPhase],
        });
        setAutoCreatedId(created.id);
        invalidate();
        const firstPhase = created.phases[0];
        if (firstPhase) setSelectedPhaseId(firstPhase.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create workflow");
      }
      return;
    }

    try {
      const created = await createPhase.mutateAsync({ definitionId: defId, phase: newPhase });
      invalidate();
      setSelectedPhaseId(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add phase");
    }
  }, [effectiveDefinitionId, name, slug, description, phases.length, createDef, createPhase, invalidate]);

  const handleUpdatePhase = useCallback(async (
    phaseId: number,
    updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>,
  ) => {
    if (!effectiveDefinitionId) return;
    try {
      await updatePhase.mutateAsync({ definitionId: effectiveDefinitionId, phaseId, phase: updates });
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update phase");
    }
  }, [effectiveDefinitionId, updatePhase, invalidate]);

  const handleDeletePhase = useCallback(async (phaseId: number) => {
    if (!effectiveDefinitionId) return;
    try {
      await deletePhase.mutateAsync({ definitionId: effectiveDefinitionId, phaseId });
      invalidate();
      if (selectedPhaseId === phaseId) setSelectedPhaseId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete phase");
    }
  }, [effectiveDefinitionId, deletePhase, invalidate, selectedPhaseId]);

  const handleReorder = useCallback(async (phaseIds: number[]) => {
    if (!effectiveDefinitionId) return;
    try {
      await reorderPhases.mutateAsync({ definitionId: effectiveDefinitionId, phase_ids: phaseIds });
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder phases");
    }
  }, [effectiveDefinitionId, reorderPhases, invalidate]);

  return {
    // State
    name, description, isPreset, isEditing, isLoading, isMutating,
    phases, selectedPhaseId, selectedPhase, activeTab,
    // Setters
    handleNameChange, setDescription,
    setSelectedPhaseId, setActiveTab,
    // Actions
    handleSave, handleAddPhase, handleUpdatePhase, handleDeletePhase, handleReorder,
    slugify,
  };
}
