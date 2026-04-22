import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PROVIDER, resolveRuntimeSelection, type AgentTypeSetting } from "../shared/models";
import type { AgentType } from "../types/agent-types";
import {
  useGetWorkspaceModelSettings,
  useGetProjectModelSettings,
  useGetFeatureModelSettings,
  useGetProjectSettings,
  useGetFeatureSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
  getGetFeatureSettingsQueryKey,
  useSetFeatureSetting,
} from "../api/generated";
import { settingsArrayToMap, useGetWorkspaceSettings } from "@/api/settings";
import {
  useAgentCatalog,
  useGetWorkspaceProviderSettings,
  useGetProjectProviderSettings,
  useGetFeatureProviderSettings,
  useSetFeatureProviderSetting,
} from "../api/agentRuntime";
import {
  isThinkingEffortSupported,
  parseThinkingEffort,
  supportedThinkingEffortLevels,
  thinkingEffortSettingKey,
  type ThinkingEffortLevel,
} from "@/shared/thinking-effort";

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
  const featureKvSettings = useGetFeatureSettings(featureId);
  const projectKvSettings = useGetProjectSettings(projectId);
  const workspaceKvSettings = useGetWorkspaceSettings();
  const featureProviderSettings = useGetFeatureProviderSettings(featureId);
  const projectProviderSettings = useGetProjectProviderSettings(projectId);
  const globalProviderSettings = useGetWorkspaceProviderSettings();

  const setModelMutation = useSetFeatureModelSetting({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId) }),
  });
  const setProviderMutation = useSetFeatureProviderSetting();
  const setThinkingEffortMutation = useSetFeatureSetting({
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId) }),
  });

  const featureSettingMap = settingsArrayToMap(featureKvSettings.data);
  const projectSettingMap = settingsArrayToMap(projectKvSettings.data);
  const workspaceSettingMap = settingsArrayToMap(workspaceKvSettings.data);

  const resolveSelection = useCallback(
    (agentType: AgentType) =>
      resolveRuntimeSelection({
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

  const resolveThinkingEffort = useCallback(
    (agentType: AgentType): ThinkingEffortLevel | undefined => {
      const selection = resolveSelection(agentType);
      const model = agentCatalog.data?.providers
        .find((provider) => provider.id === selection.providerId)
        ?.models.find((entry) => entry.id === selection.modelId);
      const levels = supportedThinkingEffortLevels(model);
      const key = thinkingEffortSettingKey(agentType as AgentTypeSetting);
      for (const value of [
        featureSettingMap[key],
        projectSettingMap[key],
        workspaceSettingMap[key],
      ]) {
        const effort = parseThinkingEffort(value);
        if (effort && isThinkingEffortSupported(levels, effort)) return effort;
      }
      return undefined;
    },
    [
      agentCatalog.data?.providers,
      featureSettingMap,
      projectSettingMap,
      resolveSelection,
      workspaceSettingMap,
    ],
  );

  const handleProviderChange = useCallback(
    (agentType: AgentType, providerId: string) => {
      setProviderMutation.mutate({
        featureId,
        providerType: agentType as AgentTypeSetting,
        provider: providerId,
      });
    },
    [featureId, setProviderMutation],
  );

  const handleThinkingEffortChange = useCallback(
    (agentType: AgentType, effort?: ThinkingEffortLevel) => {
      setThinkingEffortMutation.mutate({
        featureId,
        key: thinkingEffortSettingKey(agentType as AgentTypeSetting),
        value: effort ?? "",
      });
    },
    [featureId, setThinkingEffortMutation],
  );

  return {
    resolveModel,
    handleModelChange,
    resolveProvider,
    handleProviderChange,
    resolveThinkingEffort,
    handleThinkingEffortChange,
  };
}
