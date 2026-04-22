import { useCallback, useMemo } from "react";
import type { AgentCatalog } from "@/api/agentRuntime";
import { DEFAULT_PROVIDER } from "@/shared/models";
import { supportedThinkingEffortLevels } from "@/shared/thinking-effort";

interface UseAgentSessionModelStateParams {
  agentCatalog: AgentCatalog | undefined;
  currentProviderId?: string;
  currentModelId?: string;
  runtimeProvider?: string;
  onProviderChange?: (providerId: string) => void;
  blocksLength: number;
  status: string;
}

export function useAgentSessionModelState(params: UseAgentSessionModelStateParams) {
  const {
    agentCatalog,
    currentProviderId,
    currentModelId,
    runtimeProvider,
    onProviderChange,
    blocksLength,
    status,
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
    allModels.find((m) => m.id === currentModelId && m.providerId === activeProviderId)?.label ??
    visibleModels.find((m) => m.id === currentModelId)?.label ??
    currentModelId ??
    "Model";

  const canChangeProvider = !!onProviderChange && status === "idle" && blocksLength === 0;
  const selectableProviders = useMemo(
    () => providerOptions.filter((provider) => !provider.disabled && provider.models.length > 0),
    [providerOptions],
  );

  const supportedThinkingEfforts = supportedThinkingEffortLevels(
    visibleModels.find((model) => model.id === currentModelId),
  );

  return {
    providerOptions,
    activeProviderId,
    visibleModels,
    currentModelLabel,
    canChangeProvider,
    selectableProviders,
    supportedThinkingEfforts,
  };
}
