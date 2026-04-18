import { DEFAULT_PROVIDER_ID } from "@/lib/providers";

export const DEFAULT_PROVIDER = DEFAULT_PROVIDER_ID;

/**
 * Placeholder model ID used by session stores/hooks before the backend has
 * reported the real model via WebSocket. `"opus"` is a stable alias the
 * Claude Code CLI has always understood. The authoritative catalog of
 * available models comes from `useAgentCatalog()` → `/api/agent-catalog`.
 */
export const FALLBACK_MODEL_ID = "opus";
export const AGENT_TYPES = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro", "auto_name"] as const;
export type AgentTypeSetting = (typeof AGENT_TYPES)[number];

export interface CatalogProviderLike {
  id: string;
  default_model: string | null;
}

export interface RuntimeSelection {
  providerId: string;
  modelId: string;
}

export type AgentSettingMap = Partial<Record<AgentTypeSetting, string>>;

function explicitSetting(settings: AgentSettingMap | undefined, agentType: AgentTypeSetting): string | undefined {
  const value = settings?.[agentType];
  return value && value !== "" ? value : undefined;
}

export function defaultModelForProvider(
  providers: readonly CatalogProviderLike[] | undefined,
  providerId: string,
): string {
  return providers?.find((provider) => provider.id === providerId)?.default_model ?? FALLBACK_MODEL_ID;
}

function applySelectionOverride(
  base: RuntimeSelection,
  providerOverride: string | undefined,
  modelOverride: string | undefined,
  providers: readonly CatalogProviderLike[] | undefined,
): RuntimeSelection {
  const nextProviderId = providerOverride ?? base.providerId;
  if (modelOverride) {
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
  const rootProviderId = explicitSetting(globalProviders, agentType) ?? defaultProviderId ?? DEFAULT_PROVIDER;
  const rootModelId =
    explicitSetting(globalModels, agentType) ?? defaultModelForProvider(providers, rootProviderId);
  const projectSelection = applySelectionOverride(
    { providerId: rootProviderId, modelId: rootModelId },
    explicitSetting(projectProviders, agentType),
    explicitSetting(projectModels, agentType),
    providers,
  );

  return applySelectionOverride(
    projectSelection,
    explicitSetting(featureProviders, agentType),
    explicitSetting(featureModels, agentType),
    providers,
  );
}

const PHASE_MODEL_KEY_PREFIX = "model_phase_";
export function phaseModelKey(slug: string): string {
  return `${PHASE_MODEL_KEY_PREFIX}${slug}`;
}
