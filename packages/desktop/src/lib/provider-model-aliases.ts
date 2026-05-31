export interface CatalogModelLike {
  id: string;
  label: string;
}

export type ProviderModelAliasResolver = (
  modelId: string,
  models: readonly CatalogModelLike[],
) => string;

const MODEL_FAMILY_LABELS: Record<string, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
};

/**
 * Mirror of the backend `resolve_model_alias` (Rust:
 * packages/service/src/domain/agents/claude_code/model_alias.rs). Maps a coarse
 * Claude family alias (`sonnet`/`opus`/`haiku`, optionally with a `[1m]` suffix)
 * to the concrete catalog id the active Claude backend advertises. It is a
 * no-op when the id is already a catalog entry, so the persisted value remains
 * portable while the UI can highlight the active catalog row.
 */
export function resolveClaudeModelAlias(
  modelId: string,
  models: readonly CatalogModelLike[],
): string {
  if (models.some((model) => model.id === modelId)) return modelId;

  const normalizedModelId = modelId.toLowerCase();
  const wants1m = normalizedModelId.endsWith("[1m]");
  const normalizedBase = wants1m ? normalizedModelId.slice(0, -"[1m]".length) : normalizedModelId;
  const family = MODEL_FAMILY_LABELS[normalizedBase];
  if (!family) return modelId;

  const targetLabel = wants1m ? `${family} (1M context)` : family;
  const match = models.find((model) => model.label.toLowerCase() === targetLabel.toLowerCase());
  return match ? match.id : modelId;
}

const PROVIDER_MODEL_ALIAS_RESOLVERS: Partial<Record<string, ProviderModelAliasResolver>> = {
  claude_code: resolveClaudeModelAlias,
};

export function resolveProviderModelAlias(
  providerId: string,
  modelId: string,
  models: readonly CatalogModelLike[],
): string {
  return PROVIDER_MODEL_ALIAS_RESOLVERS[providerId]?.(modelId, models) ?? modelId;
}
