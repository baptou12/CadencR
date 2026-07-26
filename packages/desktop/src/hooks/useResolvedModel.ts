import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_PROVIDER, resolveRuntimeSelection, type AgentTypeSetting } from "../shared/models";
import type { AgentType } from "../types/agent-types";
import {
  useGetWorkspaceModelSettings,
  useGetProjectModelSettings,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
  useSetWorkspaceSetting,
} from "../api/generated";
import {
  getWorkspaceSettingsQueryKey,
  settingsArrayToMap,
  useGetWorkspaceSettings,
} from "@/api/settings";
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
  thinkingEffortModelKey,
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
const RESOLVED_MODEL_STALE_MS = 5 * 60 * 1000;

function useResolvedModelSources(featureId: number, projectId: number) {
  const agentCatalog = useAgentCatalog({ staleTime: RESOLVED_MODEL_STALE_MS });
  const featureModels = useGetFeatureModelSettings(featureId, {
    query: { staleTime: RESOLVED_MODEL_STALE_MS },
  });
  const projectModels = useGetProjectModelSettings(projectId, {
    query: { staleTime: RESOLVED_MODEL_STALE_MS },
  });
  const globalModels = useGetWorkspaceModelSettings({
    query: { staleTime: RESOLVED_MODEL_STALE_MS },
  });
  const workspaceSettings = useGetWorkspaceSettings();
  const featureProviders = useGetFeatureProviderSettings(featureId, {
    staleTime: RESOLVED_MODEL_STALE_MS,
  });
  const projectProviders = useGetProjectProviderSettings(projectId, {
    staleTime: RESOLVED_MODEL_STALE_MS,
  });
  const globalProviders = useGetWorkspaceProviderSettings({
    staleTime: RESOLVED_MODEL_STALE_MS,
  });
  return useMemo(
    () => ({
      providers: agentCatalog.data?.providers,
      defaultProviderId: agentCatalog.data?.default_provider ?? DEFAULT_PROVIDER,
      featureModels: featureModels.data,
      projectModels: projectModels.data,
      globalModels: globalModels.data,
      featureProviders: featureProviders.data,
      projectProviders: projectProviders.data,
      globalProviders: globalProviders.data,
      workspaceSettingMap: settingsArrayToMap(workspaceSettings.data),
    }),
    [
      agentCatalog.data,
      featureModels.data,
      featureProviders.data,
      globalModels.data,
      globalProviders.data,
      projectModels.data,
      projectProviders.data,
      workspaceSettings.data,
    ],
  );
}

function useResolvedModelMutations(featureId: number) {
  const queryClient = useQueryClient();
  const setModelMutation = useSetFeatureModelSetting({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId) }),
    },
  });
  const setProviderMutation = useSetFeatureProviderSetting();
  const setWorkspaceSettingMutation = useSetWorkspaceSetting({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getWorkspaceSettingsQueryKey() }),
    },
  });

  const handleModelChange = useCallback(
    (agentType: AgentType, modelId: string) => {
      setModelMutation.mutate({
        id: featureId,
        data: { model_type: agentType, model: modelId },
      });
    },
    [featureId, setModelMutation],
  );

  const setModelThinkingEffort = useCallback(
    (providerId: string, modelId: string, effort: ThinkingEffortLevel | undefined): void => {
      setWorkspaceSettingMutation.mutate({
        key: thinkingEffortModelKey(providerId, modelId),
        data: { value: effort ?? "" },
      });
    },
    [setWorkspaceSettingMutation],
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
  return useMemo(
    () => ({ handleModelChange, handleProviderChange, setModelThinkingEffort }),
    [handleModelChange, handleProviderChange, setModelThinkingEffort],
  );
}

export function useResolvedModel(featureId: number, projectId: number) {
  const sources = useResolvedModelSources(featureId, projectId);
  const mutations = useResolvedModelMutations(featureId);
  const resolveSelection = useCallback(
    (agentType: AgentType) =>
      resolveRuntimeSelection({
        agentType: agentType as AgentTypeSetting,
        providers: sources.providers,
        defaultProviderId: sources.defaultProviderId,
        globalModels: sources.globalModels,
        globalProviders: sources.globalProviders,
        projectModels: sources.projectModels,
        projectProviders: sources.projectProviders,
        featureModels: sources.featureModels,
        featureProviders: sources.featureProviders,
      }),
    [sources],
  );
  const resolveModel = useCallback(
    (agentType: AgentType): string => resolveSelection(agentType).modelId,
    [resolveSelection],
  );
  const resolveProvider = useCallback(
    (agentType: AgentType): string => resolveSelection(agentType).providerId,
    [resolveSelection],
  );
  const resolveModelThinkingEffort = useCallback(
    (providerId: string, modelId: string): ThinkingEffortLevel | undefined => {
      const model = sources.providers
        ?.find((provider) => provider.id === providerId)
        ?.models.find((entry) => entry.id === modelId);
      const levels = supportedThinkingEffortLevels(model);
      const value = sources.workspaceSettingMap[thinkingEffortModelKey(providerId, modelId)];
      const effort = parseThinkingEffort(value);
      return effort && isThinkingEffortSupported(levels, effort) ? effort : undefined;
    },
    [sources],
  );

  // Stabilize the return value: a fresh object literal would propagate a new
  // `value` through `ResolvedModelContext` on every render of the provider,
  // re-rendering every consumer. Each member callback is already stable
  // (wrapped in `useCallback`), so a deps-keyed `useMemo` keeps the whole
  // object identity-stable across renders.
  return useMemo(
    () => ({
      resolveModel,
      handleModelChange: mutations.handleModelChange,
      resolveProvider,
      handleProviderChange: mutations.handleProviderChange,
      resolveModelThinkingEffort,
      setModelThinkingEffort: mutations.setModelThinkingEffort,
    }),
    [mutations, resolveModel, resolveModelThinkingEffort, resolveProvider],
  );
}
