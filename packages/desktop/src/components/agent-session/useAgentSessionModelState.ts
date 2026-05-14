import { useCallback, useMemo } from "react";
import type { AgentCatalog } from "@/api/agentRuntime";
import { DEFAULT_PROVIDER } from "@/shared/models";
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
      (agentCatalog?.providers ?? []).map((provider) => ({
        id: provider.id,
        label: provider.label,
        disabled: provider.status !== "available",
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

  const providerSupportsModel = useCallback(
    (providerId?: string) => {
      if (!providerId || !currentModelId) return false;
      const provider = providerOptions.find((entry) => entry.id === providerId);
      if (!provider) return false;
      return provider.models.some((model) => model.id === currentModelId);
    },
    [currentModelId, providerOptions],
  );

  const activeProviderId = useMemo(() => {
    const preferredCurrentProvider =
      currentProviderId && (!currentModelId || providerSupportsModel(currentProviderId))
        ? currentProviderId
        : undefined;
    if (preferredCurrentProvider) return preferredCurrentProvider;

    const preferredRuntimeProvider =
      runtimeProvider && (!currentModelId || providerSupportsModel(runtimeProvider))
        ? runtimeProvider
        : undefined;
    if (preferredRuntimeProvider) return preferredRuntimeProvider;

    return modelProviderId ?? runtimeProvider ?? currentProviderId ?? DEFAULT_PROVIDER;
  }, [currentProviderId, currentModelId, modelProviderId, providerSupportsModel, runtimeProvider]);

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
