import claudeLogo from "../../assets/providers/claude.png";
import codexLogo from "../../assets/providers/codex.png";
import opencodeLogo from "../../assets/providers/opencode.png";

export const DEFAULT_PROVIDER_ID = "claude_code";

interface ProviderMetadata {
  id: string;
  label: string;
  iconSrc: string;
}

const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  claude_code: {
    id: "claude_code",
    label: "Claude Code",
    iconSrc: claudeLogo,
  },
  codex_cli: {
    id: "codex_cli",
    label: "Codex CLI",
    iconSrc: codexLogo,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    iconSrc: opencodeLogo,
  },
};

export function getProviderMetadata(providerId?: string | null): ProviderMetadata | null {
  if (!providerId) {
    return null;
  }
  return PROVIDER_METADATA[providerId] ?? null;
}

export function isDefaultProvider(providerId?: string | null): boolean {
  return providerId === DEFAULT_PROVIDER_ID;
}

export function resolveLegacyClaudeSessionId(
  runtimeProvider?: string | null,
  runtimeSessionId?: string | null,
): string | undefined {
  if (!runtimeProvider) return undefined;
  if (!isDefaultProvider(runtimeProvider)) return "";
  return runtimeSessionId ?? undefined;
}
