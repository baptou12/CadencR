import { useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  AGENT_TYPES,
  availableCatalogProviders,
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
  getGetProjectModelSettingsQueryKey,
  getGetWorkspaceModelSettingsQueryKey,
  useGetFeatureModelSettings,
  useGetProjectModelSettings,
  useGetWorkspaceModelSettings,
  useSetFeatureModelSetting,
  useSetProjectModelSetting,
  useSetWorkspaceModelSetting,
} from "@/api/generated";
import type { ModelSelectorRowProvider } from "@/components/ModelSelectorRow";
import {
  getModelDescription,
  getModelLabel,
  getProviderLabel,
  INHERIT_VALUE,
  type UseModelSelectorStateParams,
  type UseModelSelectorStateResult,
  WORKSPACE_ONLY_AGENT_TYPES,
  type ModelSelectorLevel,
  type ModelSelectorRowState,
} from "@/hooks/modelSelectorShared";
function useModelSelectorQueries(params: UseModelSelectorStateParams) {
  const { level, projectId, featureId } = params;
  const agentCatalog = useAgentCatalog();
  const globalSettings = useGetWorkspaceModelSettings({ query: { enabled: level === "global" } });
  const projectSettings = useGetProjectModelSettings(projectId ?? 0, {
    query: { enabled: level === "project" && projectId != null },
  });
  const featureSettings = useGetFeatureModelSettings(featureId ?? 0, {
    query: { enabled: level === "feature" && featureId != null },
  });
  const parentGlobalSettings = useGetWorkspaceModelSettings({
    query: { enabled: level !== "global" },
  });
  const parentProjectSettings = useGetProjectModelSettings(projectId ?? 0, {
    query: { enabled: level === "feature" && projectId != null },
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
  const providers = useMemo<ModelSelectorRowProvider[]>(
    () =>
      availableCatalogProviders(agentCatalog.data?.providers).map((provider) => ({
        id: provider.id,
        label: provider.label,
        disabled: false,
        status: provider.status,
        statusMessage: provider.status_message,
        models: provider.models,
      })),
    [agentCatalog.data],
  );
  return {
    agentCatalog,
    featureProviderSettings,
    featureSettings,
    globalProviderSettings,
    globalSettings,
    parentGlobalProviderSettings,
    parentGlobalSettings,
    parentProjectProviderSettings,
    parentProjectSettings,
    projectProviderSettings,
    projectSettings,
    providers,
  };
}

type ModelSelectorQueries = ReturnType<typeof useModelSelectorQueries>;

function useModelSelectorMutations(params: UseModelSelectorStateParams) {
  const { projectId, featureId } = params;
  const queryClient = useQueryClient();
  const globalMutation = useSetWorkspaceModelSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetWorkspaceModelSettingsQueryKey() });
        toast.success("Settings saved");
      },
    },
  });
  const projectMutation = useSetProjectModelSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetProjectModelSettingsQueryKey(projectId ?? 0),
        });
        toast.success("Settings saved");
      },
    },
  });
  const featureMutation = useSetFeatureModelSetting({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: getGetFeatureModelSettingsQueryKey(featureId ?? 0),
        });
        toast.success("Settings saved");
      },
    },
  });
  const providerCallbacks = {
    onSuccess: () => toast.success("Settings saved"),
    onError: () => toast.error("Failed to save provider setting"),
  };
  const globalProviderMutation = useSetWorkspaceProviderSetting(providerCallbacks);
  const projectProviderMutation = useSetProjectProviderSetting(providerCallbacks);
  const featureProviderMutation = useSetFeatureProviderSetting(providerCallbacks);
  return {
    featureMutation,
    featureProviderMutation,
    globalMutation,
    globalProviderMutation,
    projectMutation,
    projectProviderMutation,
  };
}

type ModelSelectorMutations = ReturnType<typeof useModelSelectorMutations>;

function resolveSelection(
  agentType: AgentTypeSetting,
  targetLevel: ModelSelectorLevel,
  queries: ModelSelectorQueries,
): RuntimeSelection {
  return resolveRuntimeSelection({
    agentType,
    providers: queries.agentCatalog.data?.providers,
    defaultProviderId: queries.agentCatalog.data?.default_provider ?? DEFAULT_PROVIDER,
    globalModels: queries.globalSettings.data ?? queries.parentGlobalSettings.data,
    globalProviders:
      queries.globalProviderSettings.data ?? queries.parentGlobalProviderSettings.data,
    ...(targetLevel !== "global"
      ? {
          projectModels: queries.projectSettings.data ?? queries.parentProjectSettings.data,
          projectProviders:
            queries.projectProviderSettings.data ?? queries.parentProjectProviderSettings.data,
        }
      : {}),
    ...(targetLevel === "feature"
      ? {
          featureModels: queries.featureSettings.data,
          featureProviders: queries.featureProviderSettings.data,
        }
      : {}),
  });
}

function currentValues(
  agentType: AgentTypeSetting,
  params: UseModelSelectorStateParams,
  queries: ModelSelectorQueries,
): { model: string; provider: string } {
  const { level } = params;
  const settings =
    level === "global"
      ? queries.globalSettings.data
      : level === "project"
        ? queries.projectSettings.data
        : queries.featureSettings.data;
  const providerSettings =
    level === "global"
      ? queries.globalProviderSettings.data
      : level === "project"
        ? queries.projectProviderSettings.data
        : queries.featureProviderSettings.data;
  const modelValue = (settings as Record<string, string> | undefined)?.[agentType];
  const providerValue = providerSettings?.[agentType];
  return {
    model:
      level === "global"
        ? resolveSelection(agentType, "global", queries).modelId
        : modelValue || INHERIT_VALUE,
    provider:
      level === "global"
        ? resolveSelection(agentType, "global", queries).providerId
        : providerValue || INHERIT_VALUE,
  };
}

function useModelSelectionActions(
  params: UseModelSelectorStateParams,
  queries: ModelSelectorQueries,
  mutations: ModelSelectorMutations,
) {
  return useMemo(() => {
    const changeModel = (agentType: AgentTypeSetting, value: string): void => {
      const modelId = value === INHERIT_VALUE ? "" : value;
      if (params.level === "global") {
        mutations.globalMutation.mutate({
          data: {
            agent_type: agentType,
            model_id: modelId || resolveSelection(agentType, "global", queries).modelId,
          },
        });
      } else if (params.level === "project" && params.projectId != null) {
        mutations.projectMutation.mutate({
          id: params.projectId,
          data: { model_type: agentType, model: modelId },
        });
      } else if (params.level === "feature" && params.featureId != null) {
        mutations.featureMutation.mutate({
          id: params.featureId,
          data: { model_type: agentType, model: modelId },
        });
      }
    };
    const changeProvider = (agentType: AgentTypeSetting, value: string): void => {
      const providerId = value === INHERIT_VALUE ? "" : value;
      const resolved =
        providerId || queries.agentCatalog.data?.default_provider || DEFAULT_PROVIDER;
      const selected = queries.agentCatalog.data?.providers.find(
        (provider) => provider.id === resolved,
      );
      if (providerId && (!selected || selected.status !== "available")) return;
      if (params.level === "global") {
        mutations.globalProviderMutation.mutate({ agentType, providerId: resolved });
      } else if (params.level === "project" && params.projectId != null) {
        mutations.projectProviderMutation.mutate({
          projectId: params.projectId,
          providerType: agentType,
          provider: providerId,
        });
      } else if (params.level === "feature" && params.featureId != null) {
        mutations.featureProviderMutation.mutate({
          featureId: params.featureId,
          providerType: agentType,
          provider: providerId,
        });
      }
    };
    return (agentType: AgentTypeSetting, providerValue: string, modelValue: string): void => {
      const current = currentValues(agentType, params, queries);
      if (providerValue !== current.provider) changeProvider(agentType, providerValue);
      if (modelValue !== current.model) changeModel(agentType, modelValue);
    };
  }, [mutations, params, queries]);
}

function buildModelSelectorRows(
  params: UseModelSelectorStateParams,
  queries: ModelSelectorQueries,
  applySelection: ReturnType<typeof useModelSelectionActions>,
): ModelSelectorRowState[] {
  const visibleAgentTypes = AGENT_TYPES.filter(
    (agentType) => params.level === "global" || !WORKSPACE_ONLY_AGENT_TYPES.includes(agentType),
  );
  return visibleAgentTypes.map((agentType) => {
    const targetLevel =
      params.level === "global" ? "global" : params.level === "project" ? "project" : "feature";
    const selection = resolveSelection(agentType, targetLevel, queries);
    const current = currentValues(agentType, params, queries);
    const isInherited = current.provider === INHERIT_VALUE || current.model === INHERIT_VALUE;
    return {
      agentType,
      stateLabel: params.level === "global" ? "Default" : isInherited ? "Inherited" : "Override",
      selectedProviderId: selection.providerId,
      selectedProviderLabel: getProviderLabel(queries.providers, selection.providerId),
      selectedModelId: selection.modelId,
      selectedModelLabel: getModelLabel(
        queries.agentCatalog.data?.providers,
        selection.providerId,
        selection.modelId,
      ),
      selectedModelDescription: getModelDescription(
        queries.agentCatalog.data?.providers,
        selection.providerId,
        selection.modelId,
      ),
      providers: queries.providers,
      isInherited,
      onInherit:
        params.level !== "global"
          ? () => applySelection(agentType, INHERIT_VALUE, INHERIT_VALUE)
          : undefined,
      onSelect: (providerId, modelId) => applySelection(agentType, providerId, modelId),
    } satisfies ModelSelectorRowState;
  });
}

export function useModelSelectorState(
  params: UseModelSelectorStateParams,
): UseModelSelectorStateResult {
  const queries = useModelSelectorQueries(params);
  const mutations = useModelSelectorMutations(params);
  const applySelection = useModelSelectionActions(params, queries, mutations);
  const rows = buildModelSelectorRows(params, queries, applySelection);
  const { level } = params;
  const isLoading =
    queries.agentCatalog.isLoading ||
    (level === "global" &&
      (queries.globalSettings.isLoading || queries.globalProviderSettings.isLoading)) ||
    (level === "project" &&
      (queries.projectSettings.isLoading || queries.projectProviderSettings.isLoading)) ||
    (level === "feature" &&
      (queries.featureSettings.isLoading || queries.featureProviderSettings.isLoading));
  return { isLoading, hasCatalogError: Boolean(queries.agentCatalog.error), rows };
}
