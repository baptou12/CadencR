import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL } from "../../shared/models";
import type { AgentType } from "../../main/agents/types";
import {
  useGetWorkspaceModelSettings,
  useGetProjectModelSettings,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
} from "../api/generated";

/**
 * Hook that resolves the effective model for an agent type through the
 * settings hierarchy: feature → project → global → DEFAULT_MODEL.
 *
 * Returns the resolved model ID and a mutation to update the feature-level setting.
 */
export function useResolvedModel(featureId: number, projectId: number) {
  const queryClient = useQueryClient();

  const featureSettings = useGetFeatureModelSettings(featureId);
  const projectSettings = useGetProjectModelSettings(projectId);
  const globalSettings = useGetWorkspaceModelSettings();

  const setModelMutation = useSetFeatureModelSetting({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId) }),
  });

  /** Resolve model through the hierarchy for display */
  const resolveModel = useCallback(
    (agentType: AgentType): string => {
      const featureVal = featureSettings.data?.[agentType as keyof typeof featureSettings.data];
      if (featureVal) return featureVal;

      const projectVal = projectSettings.data?.[agentType as keyof typeof projectSettings.data];
      if (projectVal) return projectVal;

      const globalVal = globalSettings.data?.[agentType as keyof typeof globalSettings.data];
      if (globalVal) return globalVal;

      return DEFAULT_MODEL;
    },
    [featureSettings, projectSettings, globalSettings],
  );

  const handleModelChange = useCallback(
    (agentType: AgentType, modelId: string) => {
      setModelMutation.mutate({ featureId, modelType: agentType, model: modelId });
    },
    [featureId, setModelMutation],
  );

  return { resolveModel, handleModelChange };
}
