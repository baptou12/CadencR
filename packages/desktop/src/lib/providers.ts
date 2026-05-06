import claudeLogo from "../../assets/providers/claude.png";
import codexLogo from "../../assets/providers/codex.png";
import opencodeLogo from "../../assets/providers/opencode.png";

export const PROVIDER_IDS = {
  CLAUDE_CODE: "claude_code",
  OPENCODE: "opencode",
  CODEX_CLI: "codex_cli",
} as const;

export type ProviderId = (typeof PROVIDER_IDS)[keyof typeof PROVIDER_IDS];

export const DEFAULT_PROVIDER_ID: ProviderId = PROVIDER_IDS.CLAUDE_CODE;

export interface ProviderMetadata {
  id: string;
  label: string;
  iconSrc: string | null;
}

/** Map provider IDs to their bundled icon assets. */
const PROVIDER_ICONS: Record<ProviderId, string> = {
  [PROVIDER_IDS.CLAUDE_CODE]: claudeLogo,
  [PROVIDER_IDS.CODEX_CLI]: codexLogo,
  [PROVIDER_IDS.OPENCODE]: opencodeLogo,
};

/**
 * Get provider metadata. Returns icon from the local asset map and label from
 * the optional catalog data (falls back to the provider ID as a label).
 * New providers only need to add an icon asset + one entry in PROVIDER_ICONS.
 */
export function getProviderMetadata(
  providerId?: string | null,
  catalogLabel?: string | null,
): ProviderMetadata | null {
  if (!providerId) {
    return null;
  }
  return {
    id: providerId,
    label: catalogLabel ?? formatProviderId(providerId),
    iconSrc: PROVIDER_ICONS[providerId as ProviderId] ?? null,
  };
}

/** Convert a snake_case provider ID to a human-readable label. */
function formatProviderId(id: string): string {
  return id
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function isDefaultProvider(providerId?: string | null): boolean {
  return providerId === DEFAULT_PROVIDER_ID;
}
