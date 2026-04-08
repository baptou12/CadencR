import { createElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL } from "../shared/models";
import { AGENT_ICONS } from "./agent-icons";
import { ModelPickerRow, INHERIT_VALUE } from "./ModelPickerRow";
import {
  useGetWorkspaceModelSettings,
  useSetWorkspaceModelSetting,
  getGetWorkspaceModelSettingsQueryKey,
  useGetProjectModelSettings,
  useSetProjectModelSetting,
  getGetProjectModelSettingsQueryKey,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
  useListModels,
} from "../api/generated";

const AGENT_TYPES = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
type AgentType = (typeof AGENT_TYPES)[number];

const AGENT_LABELS: Record<AgentType, string> = {
  plan: "Plan",
  prd: "PRD",
  execute: "Execute",
  risk: "Risk",
  review: "Review",
  "review-fixer": "Review Fixer",
  session: "Session",
  qa: "QA",
  retro: "Retro",
};

interface ModelSelectorProps {
  level: "global" | "project" | "feature";
  projectId?: number;
  featureId?: number;
}

export function ModelSelector({ level, projectId, featureId }: ModelSelectorProps) {
  const queryClient = useQueryClient();
  const { data: models = [] } = useListModels();

  const globalSettings = useGetWorkspaceModelSettings({ enabled: level === "global" });
  const projectSettings = useGetProjectModelSettings(projectId ?? 0, {
    enabled: level === "project" && projectId != null,
  });
  const featureSettings = useGetFeatureModelSettings(featureId ?? 0, {
    enabled: level === "feature" && featureId != null,
  });

  const parentGlobalSettings = useGetWorkspaceModelSettings({ enabled: level !== "global" });
  const parentProjectSettings = useGetProjectModelSettings(projectId ?? 0, {
    enabled: level === "feature" && projectId != null,
  });

  const globalMutation = useSetWorkspaceModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceModelSettingsQueryKey() });
      toast.success("Settings saved");
    },
  });
  const projectMutation = useSetProjectModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetProjectModelSettingsQueryKey(projectId ?? 0) });
      toast.success("Settings saved");
    },
  });
  const featureMutation = useSetFeatureModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId ?? 0) });
      toast.success("Settings saved");
    },
  });

  const settings =
    level === "global" ? globalSettings.data : level === "project" ? projectSettings.data : featureSettings.data;

  const isLoading =
    (level === "global" && globalSettings.isLoading) ||
    (level === "project" && projectSettings.isLoading) ||
    (level === "feature" && featureSettings.isLoading);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  function getEffectiveModel(agentType: AgentType): string {
    if (level === "feature") {
      const projectVal = parentProjectSettings.data?.[agentType];
      if (projectVal) return projectVal;
    }
    if (level !== "global") {
      const globalVal = parentGlobalSettings.data?.[agentType];
      if (globalVal) return globalVal;
    }
    return DEFAULT_MODEL;
  }

  function getCurrentValue(agentType: AgentType): string {
    const val = settings?.[agentType];
    if (level === "global") return val ?? DEFAULT_MODEL;
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function handleChange(agentType: AgentType, value: string): void {
    const modelId = value === INHERIT_VALUE ? "" : value;
    if (level === "global") {
      globalMutation.mutate({ agentType, modelId: modelId || DEFAULT_MODEL });
    } else if (level === "project" && projectId != null) {
      projectMutation.mutate({ projectId, modelType: agentType, model: modelId });
    } else if (level === "feature" && featureId != null) {
      featureMutation.mutate({ featureId, modelType: agentType, model: modelId });
    }
  }

  return (
    <div className="space-y-2">
      {AGENT_TYPES.map((agentType) => (
        <ModelPickerRow
          key={agentType}
          label={
            <>
              {createElement(AGENT_ICONS[agentType], { className: "size-3.5" })}
              {AGENT_LABELS[agentType] ?? agentType}
            </>
          }
          models={models}
          currentValue={getCurrentValue(agentType)}
          effectiveModel={getEffectiveModel(agentType)}
          showInherit={level !== "global"}
          onSelect={(value) => handleChange(agentType, value)}
        />
      ))}
    </div>
  );
}
