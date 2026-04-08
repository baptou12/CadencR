import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL, phaseModelKey } from "@/shared/models";
import { ModelPickerRow, INHERIT_VALUE } from "./ModelPickerRow";
import {
  useGetWorkflowDefinition,
  useGetFeatureSettings,
  getGetFeatureSettingsQueryKey,
  useSetFeatureSetting,
  useListModels,
} from "@/api/generated";

interface WorkflowModelSelectorProps {
  featureId: number;
  workflowDefinitionId: number;
}

export function WorkflowModelSelector({ featureId, workflowDefinitionId }: WorkflowModelSelectorProps) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useListModels();
  const { data: definition, isLoading: isDefLoading } = useGetWorkflowDefinition(workflowDefinitionId);
  const { data: featureSettingsData, isLoading: isSettingsLoading } = useGetFeatureSettings(featureId);

  const settingsMap = featureSettingsData
    ? Object.fromEntries(featureSettingsData.map((s) => [s.key, s.value]))
    : {};

  const setFeatureSetting = useSetFeatureSetting({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) });
      toast.success("Settings saved");
    },
  });

  if (isDefLoading || isSettingsLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  const phases = definition?.phases
    ? [...definition.phases].sort((a, b) => a.order_index - b.order_index)
    : [];

  function getCurrentValue(phaseSlug: string): string {
    const val = settingsMap[phaseModelKey(phaseSlug)];
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function getEffectiveModel(phaseSlug: string): string {
    const phase = phases.find((p) => p.slug === phaseSlug);
    return phase?.model_override ?? DEFAULT_MODEL;
  }

  function handleChange(phaseSlug: string, value: string): void {
    const modelId = value === INHERIT_VALUE ? "" : value;
    setFeatureSetting.mutate({ featureId, key: phaseModelKey(phaseSlug), value: modelId });
  }

  return (
    <div className="space-y-2">
      {phases.map((phase) => (
        <ModelPickerRow
          key={phase.id}
          label={phase.name}
          models={models}
          currentValue={getCurrentValue(phase.slug)}
          effectiveModel={getEffectiveModel(phase.slug)}
          showInherit
          onSelect={(value) => handleChange(phase.slug, value)}
        />
      ))}
    </div>
  );
}
