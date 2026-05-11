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

export function useResolvedModel(featureId: number, projectId: number) {
  const queryClient = useQueryClient();

  // Settings inside `useResolvedModel` change rarely and the WS layer pushes
  // updates anyway — a 5-minute staleTime collapses the dual-mount waterfall
  // (route + WebSocketSessionFeatureBlock) without losing freshness.
  const agentCatalog = useAgentCatalog({ staleTime: RESOLVED_MODEL_STALE_MS });
  const featureSettings = useGetFeatureModelSettings(featureId, {
    query: { staleTime: RESOLVED_MODEL_STALE_MS },
  });
  const projectSettings = useGetProjectModelSettings(projectId, {
    query: { staleTime: RESOLVED_MODEL_STALE_MS },
  });
  const globalSettings = useGetWorkspaceModelSettings({
    query: { staleTime: RESOLVED_MODEL_STALE_MS },
  });
  const workspaceKvSettings = useGetWorkspaceSettings();
  const featureProviderSettings = useGetFeatureProviderSettings(featureId, {
    staleTime: RESOLVED_MODEL_STALE_MS,
  });
  const projectProviderSettings = useGetProjectProviderSettings(projectId, {
    staleTime: RESOLVED_MODEL_STALE_MS,
  });
  const globalProviderSettings = useGetWorkspaceProviderSettings({
    staleTime: RESOLVED_MODEL_STALE_MS,
  });

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

  // Memoized so `resolveModelThinkingEffort` keeps a stable identity across
  // renders when the underlying KV array hasn't changed.
  const workspaceSettingMap = useMemo(
    () => settingsArrayToMap(workspaceKvSettings.data),
    [workspaceKvSettings.data],
  );

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
      setModelMutation.mutate({
        id: featureId,
        data: { model_type: agentType, model: modelId },
      });
    },
    [featureId, setModelMutation],
  );

  const resolveProvider = useCallback(
    (agentType: AgentType): string => resolveSelection(agentType).providerId,
    [resolveSelection],
  );

  /**
   * Last-used thinking effort for the (provider, model) pair, read from the
   * workspace EAV settings. Validated against the model's supported levels —
   * an unsupported value returns `undefined`.
   */
  const resolveModelThinkingEffort = useCallback(
    (providerId: string, modelId: string): ThinkingEffortLevel | undefined => {
      const model = agentCatalog.data?.providers
        .find((provider) => provider.id === providerId)
        ?.models.find((entry) => entry.id === modelId);
      const levels = supportedThinkingEffortLevels(model);
      const value = workspaceSettingMap[thinkingEffortModelKey(providerId, modelId)];
      const effort = parseThinkingEffort(value);
      return effort && isThinkingEffortSupported(levels, effort) ? effort : undefined;
    },
    [agentCatalog.data?.providers, workspaceSettingMap],
  );

  /**
   * Persist the per-model default. Used when the user adjusts effort outside
   * a live WS session (the WS effort.set handler writes its own copy on the
   * backend during a live session).
   */
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

  // Stabilize the return value: a fresh object literal would propagate a new
  // `value` through `ResolvedModelContext` on every render of the provider,
  // re-rendering every consumer. Each member callback is already stable
  // (wrapped in `useCallback`), so a deps-keyed `useMemo` keeps the whole
  // object identity-stable across renders.
  return useMemo(
    () => ({
      resolveModel,
      handleModelChange,
      resolveProvider,
      handleProviderChange,
      resolveModelThinkingEffort,
      setModelThinkingEffort,
    }),
    [
      resolveModel,
      handleModelChange,
      resolveProvider,
      handleProviderChange,
      resolveModelThinkingEffort,
      setModelThinkingEffort,
    ],
  );
}
