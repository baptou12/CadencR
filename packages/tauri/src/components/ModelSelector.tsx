import { createElement, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  AGENT_TYPES,
  DEFAULT_PROVIDER,
  resolveRuntimeSelection,
  type AgentTypeSetting,
  type RuntimeSelection,
} from "../shared/models";
import {
  useAgentCatalog,
  useGetFeatureProviderSettings,
  useGetProjectProviderSettings,
  useGetWorkspaceProviderSettings,
  useSetFeatureProviderSetting,
  useSetProjectProviderSetting,
  useSetWorkspaceProviderSetting,
} from "../api/agentRuntime";
import { AGENT_ICONS } from "./agent-icons";
import {
  useGetWorkspaceModelSettings,
  useSetWorkspaceModelSetting,
  getGetWorkspaceModelSettingsQueryKey,
  useSetWorkspaceSetting,
  useGetProjectModelSettings,
  useSetProjectModelSetting,
  getGetProjectModelSettingsQueryKey,
  getGetProjectSettingsQueryKey,
  useGetProjectSettings,
  useSetProjectSetting,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  getGetFeatureSettingsQueryKey,
  useGetFeatureSettings,
  useSetFeatureSetting,
  useSetFeatureModelSetting,
} from "../api/generated";
import { ModelSelectorRow } from "./ModelSelectorRow";
import { getWorkspaceSettingsQueryKey, useGetWorkspaceSettings, settingsArrayToMap } from "@/api/settings";
import {
  isThinkingEffortSupported,
  parseThinkingEffort,
  supportedThinkingEffortLevels,
  thinkingEffortSettingKey,
  type ThinkingEffortLevel,
} from "@/shared/thinking-effort";

type AgentType = AgentTypeSetting;
const INHERIT_VALUE = "__inherit__";

/**
 * Agent types that are configurable only at the workspace (global) level.
 * Must stay in sync with `WORKSPACE_ONLY_AGENT_TYPES` in the backend
 * (packages/service/src/domain/agents/runtime.rs) — that list is authoritative
 * and drives backend 400 errors if the frontend ever sends a project/feature
 * override for one of these.
 */
const WORKSPACE_ONLY_AGENT_TYPES: readonly AgentType[] = ["auto_name"] as const;

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
  auto_name: "Auto-naming",
};

interface ModelSelectorProps {
  level: "global" | "project" | "feature";
  projectId?: number;
  featureId?: number;
}

export function ModelSelector({ level, projectId, featureId }: ModelSelectorProps) {
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
  const projectKvSettings = useGetProjectSettings(projectId ?? 0, { enabled: level !== "global" && projectId != null });
  const featureKvSettings = useGetFeatureSettings(featureId ?? 0, { enabled: level === "feature" && featureId != null });

  const globalProviderSettings = useGetWorkspaceProviderSettings(level === "global");
  const projectProviderSettings = useGetProjectProviderSettings(projectId ?? 0, level === "project" && projectId != null);
  const featureProviderSettings = useGetFeatureProviderSettings(featureId ?? 0, level === "feature" && featureId != null);
  const parentGlobalProviderSettings = useGetWorkspaceProviderSettings(level !== "global");
  const parentProjectProviderSettings = useGetProjectProviderSettings(projectId ?? 0, level === "feature" && projectId != null);

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
  const workspaceSettingMutation = useSetWorkspaceSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getWorkspaceSettingsQueryKey() });
      toast.success("Settings saved");
    },
  });
  const projectSettingMutation = useSetProjectSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetProjectSettingsQueryKey(projectId ?? 0) });
      toast.success("Settings saved");
    },
  });
  const featureSettingMutation = useSetFeatureSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFeatureSettingsQueryKey(featureId ?? 0) });
      toast.success("Settings saved");
    },
  });

  const handleProviderMutationSuccess = () => {
    toast.success("Settings saved");
  };
  const handleProviderMutationError = () => {
    toast.error("Failed to save provider setting");
  };

  const globalProviderMutation = useSetWorkspaceProviderSetting({
    onSuccess: handleProviderMutationSuccess,
    onError: handleProviderMutationError,
  });
  const projectProviderMutation = useSetProjectProviderSetting({
    onSuccess: handleProviderMutationSuccess,
    onError: handleProviderMutationError,
  });
  const featureProviderMutation = useSetFeatureProviderSetting({
    onSuccess: handleProviderMutationSuccess,
    onError: handleProviderMutationError,
  });

  const settings =
    level === "global" ? globalSettings.data : level === "project" ? projectSettings.data : featureSettings.data;
  const providerSettings =
    level === "global" ? globalProviderSettings.data : level === "project" ? projectProviderSettings.data : featureProviderSettings.data;

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

  // useMemo must run on every render — keep it above any conditional return
  // so the hook order stays stable when `isLoading` flips.
  const providers = useMemo(() => (agentCatalog.data?.providers ?? []).map((provider) => ({
    id: provider.id,
    label: provider.status === "available" ? provider.label : `${provider.label} (Coming soon)`,
    providerId: provider.id,
    disabled: provider.status !== "available",
    models: provider.models,
  })), [agentCatalog.data]);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  if (agentCatalog.error) {
    return <div className="text-sm text-destructive">Failed to load provider catalog.</div>;
  }

  function getSelection(agentType: AgentType, targetLevel: "global" | "project" | "feature"): RuntimeSelection {
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

  function getEffectiveSelection(agentType: AgentType): RuntimeSelection {
    if (level === "global") return getSelection(agentType, "global");
    if (level === "project") return getSelection(agentType, "project");
    return getSelection(agentType, "feature");
  }

  function getCurrentValue(agentType: AgentType): string {
    const val = settings?.[agentType];
    if (level === "global") return getSelection(agentType, "global").modelId;
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function getCurrentProviderValue(agentType: AgentType): string {
    const val = providerSettings?.[agentType];
    if (level === "global") return getSelection(agentType, "global").providerId;
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function isModelSelected(agentType: AgentType, providerId: string, modelId: string): boolean {
    const selection = getEffectiveSelection(agentType);
    return providerId === selection.providerId && modelId === selection.modelId;
  }

  function handleChange(agentType: AgentType, value: string): void {
    const modelId = value === INHERIT_VALUE ? "" : value;
    if (level === "global") {
      globalMutation.mutate({
        agentType,
        modelId: modelId || getSelection(agentType, "global").modelId,
      });
    } else if (level === "project" && projectId != null) {
      projectMutation.mutate({ projectId, modelType: agentType, model: modelId });
    } else if (level === "feature" && featureId != null) {
      featureMutation.mutate({ featureId, modelType: agentType, model: modelId });
    }
  }

  function handleProviderChange(agentType: AgentType, value: string): void {
    const providerId = value === INHERIT_VALUE ? "" : value;
    const resolvedProviderId = providerId || DEFAULT_PROVIDER;
    const selectedProvider = agentCatalog.data?.providers.find((provider) => provider.id === resolvedProviderId);
    if (providerId !== "" && (!selectedProvider || selectedProvider.status !== "available")) {
      return;
    }

    if (level === "global") {
      globalProviderMutation.mutate({ agentType, providerId: resolvedProviderId });
    } else if (level === "project" && projectId != null) {
      projectProviderMutation.mutate({ projectId, providerType: agentType, provider: providerId });
    } else if (level === "feature" && featureId != null) {
      featureProviderMutation.mutate({ featureId, providerType: agentType, provider: providerId });
    }
  }

  function applySelection(agentType: AgentType, providerValue: string, modelValue: string): void {
    if (providerValue !== getCurrentProviderValue(agentType)) {
      handleProviderChange(agentType, providerValue);
    }

    if (modelValue !== getCurrentValue(agentType)) {
      handleChange(agentType, modelValue);
    }
  }

  function handleInheritSelection(agentType: AgentType): void {
    applySelection(agentType, INHERIT_VALUE, INHERIT_VALUE);
  }

  function getSelectedProvider(agentType: AgentType): string {
    return getEffectiveSelection(agentType).providerId;
  }

  function getSelectedModel(agentType: AgentType): string {
    return getEffectiveSelection(agentType).modelId;
  }

  function getProviderLabel(providerId: string): string {
    return providers.find((provider) => provider.id === providerId)?.label ?? providerId;
  }

  function getModelLabel(providerId: string, modelId: string): string {
    return (
      agentCatalog.data?.providers
        .find((provider) => provider.id === providerId)
        ?.models.find((model) => model.id === modelId)?.label ?? modelId
    );
  }

  function getModelDescription(providerId: string, modelId: string): string | undefined {
    return agentCatalog.data?.providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId)?.description;
  }

  function getModelOption(agentType: AgentType) {
    const selection = getEffectiveSelection(agentType);
    return agentCatalog.data?.providers
      .find((provider) => provider.id === selection.providerId)
      ?.models.find((model) => model.id === selection.modelId);
  }

  function currentScopeThinkingEffort(agentType: AgentType): ThinkingEffortLevel | undefined {
    const key = thinkingEffortSettingKey(agentType);
    const source = level === "global" ? workspaceSettingMap : level === "project" ? projectSettingMap : featureSettingMap;
    return parseThinkingEffort(source[key]);
  }

  function getEffectiveThinkingEffort(agentType: AgentType): ThinkingEffortLevel | undefined {
    const levels = supportedThinkingEffortLevels(getModelOption(agentType));
    const key = thinkingEffortSettingKey(agentType);
    for (const value of [featureSettingMap[key], projectSettingMap[key], workspaceSettingMap[key]]) {
      const effort = parseThinkingEffort(value);
      if (effort && isThinkingEffortSupported(levels, effort)) return effort;
    }
    return undefined;
  }

  function setThinkingEffort(agentType: AgentType, effort?: ThinkingEffortLevel): void {
    const key = thinkingEffortSettingKey(agentType);
    if (level === "global") {
      workspaceSettingMutation.mutate({ key, value: effort ?? "" });
    } else if (level === "project" && projectId != null) {
      projectSettingMutation.mutate({ projectId, key, value: effort ?? "" });
    } else if (level === "feature" && featureId != null) {
      featureSettingMutation.mutate({ featureId, key, value: effort ?? "" });
    }
  }

  function resetScopeThinkingEffortIfInvalid(agentType: AgentType, providerId: string, modelId: string): void {
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

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 p-2">
      {visibleAgentTypes.map((agentType) => (
        <ModelSelectorRow
          key={agentType}
          agentLabel={AGENT_LABELS[agentType] ?? agentType}
          stateLabel={level === "global" ? "Default" : getCurrentProviderValue(agentType) === INHERIT_VALUE || getCurrentValue(agentType) === INHERIT_VALUE ? "Inherited" : "Override"}
          level={level}
          selectedProviderId={getSelectedProvider(agentType)}
          selectedProviderLabel={getProviderLabel(getSelectedProvider(agentType))}
          selectedModelId={getSelectedModel(agentType)}
          selectedModelLabel={getModelLabel(getSelectedProvider(agentType), getSelectedModel(agentType))}
          selectedModelDescription={getModelDescription(getSelectedProvider(agentType), getSelectedModel(agentType))}
          providers={providers}
          isInherited={getCurrentProviderValue(agentType) === INHERIT_VALUE || getCurrentValue(agentType) === INHERIT_VALUE}
          isModelSelected={(providerId, modelId) => isModelSelected(agentType, providerId, modelId)}
          onInherit={level !== "global" ? () => handleInheritSelection(agentType) : undefined}
          onSelect={(providerId, modelId) => {
            applySelection(agentType, providerId, modelId);
            resetScopeThinkingEffortIfInvalid(agentType, providerId, modelId);
          }}
          thinkingEffortLevels={supportedThinkingEffortLevels(getModelOption(agentType))}
          thinkingEffort={getEffectiveThinkingEffort(agentType)}
          onThinkingEffortChange={(effort) => setThinkingEffort(agentType, effort)}
          icon={createElement(AGENT_ICONS[agentType], { className: "size-4" })}
        />
      ))}
    </div>
  );
}
