import { useMemo } from "react";
import type { AgentCatalog } from "@/api/agentRuntime";
import { availableCatalogProviders, DEFAULT_PROVIDER } from "@/shared/models";
import { supportedThinkingEffortLevels } from "@/shared/thinking-effort";

export const MODEL_CATALOG_LOADING_LABEL = "Loading model…";

interface UseAgentSessionModelStateParams {
  agentCatalog: AgentCatalog | undefined;
  currentProviderId?: string;
  currentModelId?: string;
  runtimeProvider?: string;
  onProviderChange?: (providerId: string) => void;
  hasConversation: boolean;
}

interface ActiveProviderParams {
  providerOptions: { id: string; models: { id: string }[] }[];
  currentProviderId?: string;
  currentModelId?: string;
  runtimeProvider?: string;
  modelProviderId?: string;
  defaultProviderId?: string;
}

function resolveActiveProviderId({
  providerOptions,
  currentProviderId,
  currentModelId,
  runtimeProvider,
  modelProviderId,
  defaultProviderId,
}: ActiveProviderParams): string {
  const isSelectable = (providerId?: string): boolean =>
    providerOptions.some((provider) => provider.id === providerId);
  const supportsModel = (providerId?: string): boolean => {
    if (!providerId || !currentModelId) return false;
    return (
      providerOptions
        .find((provider) => provider.id === providerId)
        ?.models.some((model) => model.id === currentModelId) ?? false
    );
  };
  if (
    currentProviderId &&
    isSelectable(currentProviderId) &&
    (!currentModelId || supportsModel(currentProviderId))
  ) {
    return currentProviderId;
  }
  if (
    runtimeProvider &&
    isSelectable(runtimeProvider) &&
    (!currentModelId || supportsModel(runtimeProvider))
  ) {
    return runtimeProvider;
  }
  return (
    modelProviderId ??
    (isSelectable(defaultProviderId) ? defaultProviderId : undefined) ??
    providerOptions[0]?.id ??
    DEFAULT_PROVIDER
  );
}

export function useAgentSessionModelState(params: UseAgentSessionModelStateParams) {
  const {
    agentCatalog,
    currentProviderId,
    currentModelId,
    runtimeProvider,
    onProviderChange,
    hasConversation,
  } = params;

  const providerOptions = useMemo(
    () =>
      availableCatalogProviders(agentCatalog?.providers).map((provider) => ({
        id: provider.id,
        label: provider.label,
        disabled: false,
        models: provider.models,
      })),
    [agentCatalog?.providers],
  );
  const isCatalogLoading = agentCatalog === undefined;

  const allModels = useMemo(
    () =>
      providerOptions.flatMap((provider) =>
        provider.models.map((model) => ({ ...model, providerId: provider.id })),
      ),
    [providerOptions],
  );

  const modelProviderId = useMemo(
    () => allModels.find((model) => model.id === currentModelId)?.providerId,
    [allModels, currentModelId],
  );

  const activeProviderId = useMemo(
    () =>
      resolveActiveProviderId({
        providerOptions,
        currentProviderId,
        currentModelId,
        runtimeProvider,
        modelProviderId,
        defaultProviderId: agentCatalog?.default_provider,
      }),
    [
      agentCatalog?.default_provider,
      currentModelId,
      currentProviderId,
      modelProviderId,
      providerOptions,
      runtimeProvider,
    ],
  );

  const activeProvider = providerOptions.find((provider) => provider.id === activeProviderId);
  const visibleModels = activeProvider?.models ?? [];
  const currentModelLabel =
    (isCatalogLoading
      ? MODEL_CATALOG_LOADING_LABEL
      : allModels.find((m) => m.id === currentModelId && m.providerId === activeProviderId)
          ?.label) ??
    visibleModels.find((m) => m.id === currentModelId)?.label ??
    currentModelId ??
    "Model";

  // Gate on conversation activity only. Backend-reported `status` races
  // with REST hydration: a freshly-created agent_sessions row is inserted
  // as 'paused' (session_bootstrap::find_or_create_session), so reading
  // status === "idle" here would lock the picker on ~20-25% of new sessions.
  const canChangeProvider = !!onProviderChange && !hasConversation;
  const supportedThinkingEfforts = supportedThinkingEffortLevels(
    visibleModels.find((model) => model.id === currentModelId),
  );

  return {
    isCatalogLoading,
    providerOptions,
    activeProviderId,
    visibleModels,
    currentModelLabel,
    canChangeProvider,
    supportedThinkingEfforts,
  };
}
