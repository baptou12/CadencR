import claudeLogo from "../../assets/providers/claude.png";
import codexLogo from "../../assets/providers/codex.png";
import opencodeLogo from "../../assets/providers/opencode.png";

export function getProviderIconSrc(providerId?: string | null): string | null {
  switch (providerId) {
    case "claude_code":
      return claudeLogo;
    case "codex_cli":
      return codexLogo;
    case "opencode":
      return opencodeLogo;
    default:
      return null;
  }
}

interface ProviderIconProps {
  providerId?: string | null;
  alt: string;
  className?: string;
}

export function ProviderIcon({ providerId, alt, className = "size-4 rounded-sm" }: ProviderIconProps) {
  const src = getProviderIconSrc(providerId);
  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
