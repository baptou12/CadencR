import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_PROVIDER,
  resolveRuntimeSelection,
  type AgentTypeSetting,
} from "../shared/models";
import type { AgentType } from "../types/agent-types";
import {
  useGetWorkspaceModelSettings,
  useGetProjectModelSettings,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
} from "../api/generated";
import {
  useAgentCatalog,
  useGetWorkspaceProviderSettings,
  useGetProjectProviderSettings,
  useGetFeatureProviderSettings,
  useSetFeatureProviderSetting,
} from "../api/agentRuntime";

/**
 * Hook that resolves the effective model for an agent type through the
 * settings hierarchy: feature → project → global → provider-specific default.
 *
 * The fallback model is provider-aware: if a nearer provider override changes
 * the effective provider, the model resets to that provider's default instead
 * of inheriting a model id from a different provider.
 *
 * Returns the resolved model ID and a mutation to update the feature-level setting.
 */
export function useResolvedModel(featureId: number, projectId: number) {
  const queryClient = useQueryClient();

  const agentCatalog = useAgentCatalog();
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

  const resolveSelection = useCallback(
    (agentType: AgentType) => resolveRuntimeSelection({
      agentType: agentType as AgentTypeSetting,
      providers: agentCatalog.data?.providers,
      defaultProviderId: agentCatalog.data?.default_provider ?? DEFAULT_PROVIDER,
      globalModels: globalSettings.data,
      globalProviders: globalProviderSettings.data,
      projectModels: projectSettings.data,
      projectProviders: projectProviderSettings.data,
      featureModels: featureSettings.data,
      featureProviders: featureProviderSettings.data,
    }),
    [
      agentCatalog.data,
      featureProviderSettings.data,
      featureSettings.data,
      globalProviderSettings.data,
      globalSettings.data,
      projectProviderSettings.data,
      projectSettings.data,
    ],
  );

  /** Resolve model through the hierarchy for display */
  const resolveModel = useCallback(
    (agentType: AgentType): string => resolveSelection(agentType).modelId,
    [resolveSelection],
  );

  const handleModelChange = useCallback(
    (agentType: AgentType, modelId: string) => {
      setModelMutation.mutate({ featureId, modelType: agentType, model: modelId });
    },
    [featureId, setModelMutation],
  );

  const resolveProvider = useCallback(
    (agentType: AgentType): string => resolveSelection(agentType).providerId,
    [resolveSelection],
  );

  const handleProviderChange = useCallback(
    (agentType: AgentType, providerId: string) => {
      setProviderMutation.mutate({ featureId, providerType: agentType as AgentTypeSetting, provider: providerId });
    },
    [featureId, setProviderMutation],
  );

  return { resolveModel, handleModelChange, resolveProvider, handleProviderChange };
}
