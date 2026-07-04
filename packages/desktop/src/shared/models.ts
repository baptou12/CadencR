import { DEFAULT_PROVIDER_ID } from "@/lib/providers";

export const DEFAULT_PROVIDER = DEFAULT_PROVIDER_ID;

/**
 * Placeholder model ID used by session stores/hooks before the backend has
 * reported the real model via WebSocket. `"opus"` is a stable alias the
 * Claude Code CLI has always understood. The authoritative catalog of
 * available models comes from `useAgentCatalog()` → `/api/agent-catalog`.
 */
export const FALLBACK_MODEL_ID = "opus";
// `session` drives the ws-session agent. Legacy ws-feature agent settings were
// removed with the workflow stack. `auto_name` is workspace-only and powers the
// auto-rename feature.
export const AGENT_TYPES = ["session", "auto_name"] as const;
export type AgentTypeSetting = (typeof AGENT_TYPES)[number];

export interface CatalogProviderLike {
  id: string;
  status?: string;
  default_model?: string | null;
}

export interface RuntimeSelection {
  providerId: string;
  modelId: string;
}

export type AgentSettingMap = Partial<Record<AgentTypeSetting, string>>;

function explicitSetting(
  settings: AgentSettingMap | undefined,
  agentType: AgentTypeSetting,
): string | undefined {
  const value = settings?.[agentType];
  return value && value !== "" ? value : undefined;
}

export function defaultModelForProvider(
  providers: readonly CatalogProviderLike[] | undefined,
  providerId: string,
): string {
  return (
    providers?.find((provider) => provider.id === providerId)?.default_model ?? FALLBACK_MODEL_ID
  );
}

export function availableCatalogProviders<T extends CatalogProviderLike>(
  providers: readonly T[] | undefined,
): T[] {
  return (providers ?? []).filter(
    (provider) => provider.status == null || provider.status === "available",
  );
}

function catalogHasProvider(
  providers: readonly CatalogProviderLike[] | undefined,
  providerId: string,
): boolean {
  return providers == null || providers.some((provider) => provider.id === providerId);
}

function usableProviderId(
  providers: readonly CatalogProviderLike[] | undefined,
  providerId: string | undefined,
): string | undefined {
  if (!providerId) return undefined;
  return catalogHasProvider(providers, providerId) ? providerId : undefined;
}

function applySelectionOverride(
  base: RuntimeSelection,
  providerOverride: string | undefined,
  modelOverride: string | undefined,
  providers: readonly CatalogProviderLike[] | undefined,
): RuntimeSelection {
  const nextProviderId = usableProviderId(providers, providerOverride) ?? base.providerId;
  if (modelOverride && (!providerOverride || nextProviderId === providerOverride)) {
    return { providerId: nextProviderId, modelId: modelOverride };
  }

  if (providerOverride && providerOverride !== base.providerId) {
    return {
      providerId: nextProviderId,
      modelId: defaultModelForProvider(providers, nextProviderId),
    };
  }

  return {
    providerId: nextProviderId,
    modelId: base.modelId,
  };
}

export function resolveRuntimeSelection(params: {
  agentType: AgentTypeSetting;
  providers: readonly CatalogProviderLike[] | undefined;
  defaultProviderId?: string | null;
  globalModels?: AgentSettingMap;
  globalProviders?: AgentSettingMap;
  projectModels?: AgentSettingMap;
  projectProviders?: AgentSettingMap;
  featureModels?: AgentSettingMap;
  featureProviders?: AgentSettingMap;
}): RuntimeSelection {
  const {
    agentType,
    providers,
    defaultProviderId,
    globalModels,
    globalProviders,
    projectModels,
    projectProviders,
    featureModels,
    featureProviders,
  } = params;
  const selectableProviders = availableCatalogProviders(providers);
  const globalProviderOverride = explicitSetting(globalProviders, agentType);
  const usableGlobalProviderOverride = usableProviderId(
    selectableProviders,
    globalProviderOverride,
  );
  const rootProviderId =
    usableGlobalProviderOverride ??
    usableProviderId(selectableProviders, defaultProviderId ?? undefined) ??
    selectableProviders[0]?.id ??
    DEFAULT_PROVIDER;
  const globalModelOverride =
    globalProviderOverride && !usableGlobalProviderOverride
      ? undefined
      : explicitSetting(globalModels, agentType);
  const rootModelId =
    globalModelOverride ?? defaultModelForProvider(selectableProviders, rootProviderId);
  const projectSelection = applySelectionOverride(
    { providerId: rootProviderId, modelId: rootModelId },
    explicitSetting(projectProviders, agentType),
    explicitSetting(projectModels, agentType),
    selectableProviders,
  );

  return applySelectionOverride(
    projectSelection,
    explicitSetting(featureProviders, agentType),
    explicitSetting(featureModels, agentType),
    selectableProviders,
  );
}

const PHASE_MODEL_KEY_PREFIX = "model_phase_";
export function phaseModelKey(slug: string): string {
  return `${PHASE_MODEL_KEY_PREFIX}${slug}`;
}
