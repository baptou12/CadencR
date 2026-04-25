import { useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  AGENT_TYPES,
  DEFAULT_PROVIDER,
  resolveRuntimeSelection,
  type AgentTypeSetting,
  type RuntimeSelection,
} from "@/shared/models";
import {
  useAgentCatalog,
  useGetFeatureProviderSettings,
  useGetProjectProviderSettings,
  useGetWorkspaceProviderSettings,
  useSetFeatureProviderSetting,
  useSetProjectProviderSetting,
  useSetWorkspaceProviderSetting,
} from "@/api/agentRuntime";
import {
  getGetFeatureModelSettingsQueryKey,
  getGetFeatureSettingsQueryKey,
  getGetProjectModelSettingsQueryKey,
  getGetProjectSettingsQueryKey,
  getGetWorkspaceModelSettingsQueryKey,
  useGetFeatureModelSettings,
  useGetFeatureSettings,
  useGetProjectModelSettings,
  useGetProjectSettings,
  useGetWorkspaceModelSettings,
  useSetFeatureModelSetting,
  useSetFeatureSetting,
  useSetProjectModelSetting,
  useSetProjectSetting,
  useSetWorkspaceModelSetting,
  useSetWorkspaceSetting,
} from "@/api/generated";
import {
  getWorkspaceSettingsQueryKey,
  settingsArrayToMap,
  useGetWorkspaceSettings,
} from "@/api/settings";
import type { ModelSelectorRowProvider } from "@/components/ModelSelectorRow";
import {
  getModelDescription,
  getModelLabel,
  getModelOption,
  getProviderLabel,
  INHERIT_VALUE,
  type UseModelSelectorStateParams,
  type UseModelSelectorStateResult,
  WORKSPACE_ONLY_AGENT_TYPES,
  type ModelSelectorLevel,
  type ModelSelectorRowState,
} from "@/hooks/modelSelectorShared";
import {
  isThinkingEffortSupported,
  parseThinkingEffort,
  supportedThinkingEffortLevels,
  thinkingEffortSettingKey,
  type ThinkingEffortLevel,
} from "@/shared/thinking-effort";
export function useModelSelectorState(
  params: UseModelSelectorStateParams,
): UseModelSelectorStateResult {
  const { level, projectId, featureId } = params;
  const queryClient = useQueryClient();
  const agentCatalog = useAgentCatalog();
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
  const workspaceKvSettings = useGetWorkspaceSettings();
  const projectKvSettings = useGetProjectSettings(projectId ?? 0, {
    enabled: level !== "global" && projectId != null,
  });
  const featureKvSettings = useGetFeatureSettings(featureId ?? 0, {
    enabled: level === "feature" && featureId != null,
  });
  const globalProviderSettings = useGetWorkspaceProviderSettings(level === "global");
  const projectProviderSettings = useGetProjectProviderSettings(
    projectId ?? 0,
    level === "project" && projectId != null,
  );
  const featureProviderSettings = useGetFeatureProviderSettings(
    featureId ?? 0,
    level === "feature" && featureId != null,
  );
  const parentGlobalProviderSettings = useGetWorkspaceProviderSettings(level !== "global");
  const parentProjectProviderSettings = useGetProjectProviderSettings(
    projectId ?? 0,
    level === "feature" && projectId != null,
  );

  const globalMutation = useSetWorkspaceModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceModelSettingsQueryKey() });
      toast.success("Settings saved");
    },
  });
  const projectMutation = useSetProjectModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: getGetProjectModelSettingsQueryKey(projectId ?? 0),
      });
      toast.success("Settings saved");
    },
  });
  const featureMutation = useSetFeatureModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: getGetFeatureModelSettingsQueryKey(featureId ?? 0),
      });
      toast.success("Settings saved");
    },
  });
  const workspaceSettingMutation = useSetWorkspaceSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getWorkspaceSettingsQueryKey() });
      toast.success("Settings saved");
    },
  });
  const projectSettingMutation = useSetProjectSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: getGetProjectSettingsQueryKey(projectId ?? 0),
      });
      toast.success("Settings saved");
    },
  });
  const featureSettingMutation = useSetFeatureSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: getGetFeatureSettingsQueryKey(featureId ?? 0),
      });
      toast.success("Settings saved");
    },
  });

  const globalProviderMutation = useSetWorkspaceProviderSetting({
    onSuccess: () => toast.success("Settings saved"),
    onError: () => toast.error("Failed to save provider setting"),
  });
  const projectProviderMutation = useSetProjectProviderSetting({
    onSuccess: () => toast.success("Settings saved"),
    onError: () => toast.error("Failed to save provider setting"),
  });
  const featureProviderMutation = useSetFeatureProviderSetting({
    onSuccess: () => toast.success("Settings saved"),
    onError: () => toast.error("Failed to save provider setting"),
  });

  const settings =
    level === "global"
      ? globalSettings.data
      : level === "project"
        ? projectSettings.data
        : featureSettings.data;
  const providerSettings =
    level === "global"
      ? globalProviderSettings.data
      : level === "project"
        ? projectProviderSettings.data
        : featureProviderSettings.data;

  const isLoading =
    (level === "global" && globalSettings.isLoading) ||
    (level === "project" && projectSettings.isLoading) ||
    (level === "feature" && featureSettings.isLoading) ||
    (level === "global" && globalProviderSettings.isLoading) ||
    (level === "project" && projectProviderSettings.isLoading) ||
    (level === "feature" && featureProviderSettings.isLoading) ||
    workspaceKvSettings.isLoading ||
    (level !== "global" && projectKvSettings.isLoading) ||
    (level === "feature" && featureKvSettings.isLoading) ||
    agentCatalog.isLoading;

  const workspaceSettingMap = settingsArrayToMap(workspaceKvSettings.data);
  const projectSettingMap = settingsArrayToMap(projectKvSettings.data);
  const featureSettingMap = settingsArrayToMap(featureKvSettings.data);

  const providers = useMemo<ModelSelectorRowProvider[]>(
    () =>
      (agentCatalog.data?.providers ?? []).map((provider) => ({
        id: provider.id,
        label: provider.status === "available" ? provider.label : `${provider.label} (Coming soon)`,
        disabled: provider.status !== "available",
        models: provider.models,
      })),
    [agentCatalog.data],
  );

  function getSelection(
    agentType: AgentTypeSetting,
    targetLevel: ModelSelectorLevel,
  ): RuntimeSelection {
    return resolveRuntimeSelection({
      agentType,
      providers: agentCatalog.data?.providers,
      defaultProviderId: agentCatalog.data?.default_provider ?? DEFAULT_PROVIDER,
      globalModels: globalSettings.data ?? parentGlobalSettings.data,
      globalProviders: globalProviderSettings.data ?? parentGlobalProviderSettings.data,
      ...(targetLevel !== "global"
        ? {
            projectModels: projectSettings.data ?? parentProjectSettings.data,
            projectProviders: projectProviderSettings.data ?? parentProjectProviderSettings.data,
          }
        : {}),
      ...(targetLevel === "feature"
        ? {
            featureModels: featureSettings.data,
            featureProviders: featureProviderSettings.data,
          }
        : {}),
    });
  }

  function getEffectiveSelection(agentType: AgentTypeSetting): RuntimeSelection {
    if (level === "global") return getSelection(agentType, "global");
    if (level === "project") return getSelection(agentType, "project");
    return getSelection(agentType, "feature");
  }

  function getCurrentValue(agentType: AgentTypeSetting): string {
    const value = settings?.[agentType];
    if (level === "global") return getSelection(agentType, "global").modelId;
    return value && value !== "" ? value : INHERIT_VALUE;
  }

  function getCurrentProviderValue(agentType: AgentTypeSetting): string {
    const value = providerSettings?.[agentType];
    if (level === "global") return getSelection(agentType, "global").providerId;
    return value && value !== "" ? value : INHERIT_VALUE;
  }

  function handleModelChange(agentType: AgentTypeSetting, value: string): void {
    const modelId = value === INHERIT_VALUE ? "" : value;
    if (level === "global") {
      globalMutation.mutate({
        agentType,
        modelId: modelId || getSelection(agentType, "global").modelId,
      });
      return;
    }
    if (level === "project" && projectId != null) {
      projectMutation.mutate({ projectId, modelType: agentType, model: modelId });
      return;
    }
    if (level === "feature" && featureId != null) {
      featureMutation.mutate({ featureId, modelType: agentType, model: modelId });
    }
  }

  function handleProviderChange(agentType: AgentTypeSetting, value: string): void {
    const providerId = value === INHERIT_VALUE ? "" : value;
    const resolvedProviderId = providerId || DEFAULT_PROVIDER;
    const selectedProvider = agentCatalog.data?.providers.find(
      (provider) => provider.id === resolvedProviderId,
    );
    if (providerId !== "" && (!selectedProvider || selectedProvider.status !== "available")) {
      return;
    }

    if (level === "global") {
      globalProviderMutation.mutate({ agentType, providerId: resolvedProviderId });
      return;
    }
    if (level === "project" && projectId != null) {
      projectProviderMutation.mutate({ projectId, providerType: agentType, provider: providerId });
      return;
    }
    if (level === "feature" && featureId != null) {
      featureProviderMutation.mutate({ featureId, providerType: agentType, provider: providerId });
    }
  }

  function applySelection(
    agentType: AgentTypeSetting,
    providerValue: string,
    modelValue: string,
  ): void {
    if (providerValue !== getCurrentProviderValue(agentType)) {
      handleProviderChange(agentType, providerValue);
    }
    if (modelValue !== getCurrentValue(agentType)) {
      handleModelChange(agentType, modelValue);
    }
  }

  function currentScopeThinkingEffort(
    agentType: AgentTypeSetting,
  ): ThinkingEffortLevel | undefined {
    const key = thinkingEffortSettingKey(agentType);
    const source =
      level === "global"
        ? workspaceSettingMap
        : level === "project"
          ? projectSettingMap
          : featureSettingMap;
    return parseThinkingEffort(source[key]);
  }

  function getEffectiveThinkingEffort(
    agentType: AgentTypeSetting,
  ): ThinkingEffortLevel | undefined {
    const selection = getEffectiveSelection(agentType);
    const levels = supportedThinkingEffortLevels(
      getModelOption(agentCatalog.data?.providers, selection.providerId, selection.modelId),
    );
    const key = thinkingEffortSettingKey(agentType);
    for (const value of [
      featureSettingMap[key],
      projectSettingMap[key],
      workspaceSettingMap[key],
    ]) {
      const effort = parseThinkingEffort(value);
      if (effort && isThinkingEffortSupported(levels, effort)) return effort;
    }
    return undefined;
  }

  function setThinkingEffort(agentType: AgentTypeSetting, effort?: ThinkingEffortLevel): void {
    const key = thinkingEffortSettingKey(agentType);
    if (level === "global") {
      workspaceSettingMutation.mutate({ key, value: effort ?? "" });
      return;
    }
    if (level === "project" && projectId != null) {
      projectSettingMutation.mutate({ projectId, key, value: effort ?? "" });
      return;
    }
    if (level === "feature" && featureId != null) {
      featureSettingMutation.mutate({ featureId, key, value: effort ?? "" });
    }
  }

  function resetScopeThinkingEffortIfInvalid(
    agentType: AgentTypeSetting,
    providerId: string,
    modelId: string,
  ): void {
    const model = agentCatalog.data?.providers
      .find((provider) => provider.id === providerId)
      ?.models.find((entry) => entry.id === modelId);
    const levels = supportedThinkingEffortLevels(model);
    const current = currentScopeThinkingEffort(agentType);
    if (current && !levels.includes(current)) setThinkingEffort(agentType);
  }

  const visibleAgentTypes = AGENT_TYPES.filter(
    (agentType) => level === "global" || !WORKSPACE_ONLY_AGENT_TYPES.includes(agentType),
  );

  const rows = visibleAgentTypes.map((agentType) => {
    const selection = getEffectiveSelection(agentType);
    const isInherited =
      getCurrentProviderValue(agentType) === INHERIT_VALUE ||
      getCurrentValue(agentType) === INHERIT_VALUE;

    return {
      agentType,
      stateLabel: level === "global" ? "Default" : isInherited ? "Inherited" : "Override",
      selectedProviderId: selection.providerId,
      selectedProviderLabel: getProviderLabel(providers, selection.providerId),
      selectedModelId: selection.modelId,
      selectedModelLabel: getModelLabel(
        agentCatalog.data?.providers,
        selection.providerId,
        selection.modelId,
      ),
      selectedModelDescription: getModelDescription(
        agentCatalog.data?.providers,
        selection.providerId,
        selection.modelId,
      ),
      providers,
      isInherited,
      onInherit:
        level !== "global"
          ? () => applySelection(agentType, INHERIT_VALUE, INHERIT_VALUE)
          : undefined,
      onSelect: (providerId: string, modelId: string) => {
        applySelection(agentType, providerId, modelId);
        resetScopeThinkingEffortIfInvalid(agentType, providerId, modelId);
      },
      thinkingEffortLevels: supportedThinkingEffortLevels(
        getModelOption(agentCatalog.data?.providers, selection.providerId, selection.modelId),
      ),
      thinkingEffort: getEffectiveThinkingEffort(agentType),
      onThinkingEffortChange: (effort?: ThinkingEffortLevel) =>
        setThinkingEffort(agentType, effort),
    } satisfies ModelSelectorRowState;
  });

  return {
    isLoading,
    hasCatalogError: Boolean(agentCatalog.error),
    rows,
  };
}
