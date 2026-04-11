import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, type AgentTypeSetting } from "../shared/models";
import type { AgentType } from "../types/agent-types";
import {
  useGetWorkspaceModelSettings,
  useGetProjectModelSettings,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
} from "../api/generated";
import {
  useGetWorkspaceProviderSettings,
  useGetProjectProviderSettings,
  useGetFeatureProviderSettings,
  useSetFeatureProviderSetting,
} from "../api/agentRuntime";

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
  const featureProviderSettings = useGetFeatureProviderSettings(featureId);
  const projectProviderSettings = useGetProjectProviderSettings(projectId);
  const globalProviderSettings = useGetWorkspaceProviderSettings();

  const setModelMutation = useSetFeatureModelSetting({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId) }),
  });
  const setProviderMutation = useSetFeatureProviderSetting();

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
    [featureSettings.data, projectSettings.data, globalSettings.data],
  );

  const handleModelChange = useCallback(
    (agentType: AgentType, modelId: string) => {
      setModelMutation.mutate({ featureId, modelType: agentType, model: modelId });
    },
    [featureId, setModelMutation],
  );

  const resolveProvider = useCallback(
    (agentType: AgentType): string => {
      const featureVal = featureProviderSettings.data?.[agentType as keyof typeof featureProviderSettings.data];
      if (featureVal) return featureVal;

      const projectVal = projectProviderSettings.data?.[agentType as keyof typeof projectProviderSettings.data];
      if (projectVal) return projectVal;

      const globalVal = globalProviderSettings.data?.[agentType as keyof typeof globalProviderSettings.data];
      if (globalVal) return globalVal;

      return DEFAULT_PROVIDER;
    },
    [featureProviderSettings.data, projectProviderSettings.data, globalProviderSettings.data],
  );

  const handleProviderChange = useCallback(
    (agentType: AgentType, providerId: string) => {
      setProviderMutation.mutate({ featureId, providerType: agentType as AgentTypeSetting, provider: providerId });
    },
    [featureId, setProviderMutation],
  );

  return { resolveModel, handleModelChange, resolveProvider, handleProviderChange };
}
