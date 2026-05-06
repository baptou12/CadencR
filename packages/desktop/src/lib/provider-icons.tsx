import { getProviderMetadata } from "./providers";

export function getProviderIconSrc(providerId?: string | null): string | null {
  return getProviderMetadata(providerId)?.iconSrc ?? null;
}

interface ProviderIconProps {
  providerId?: string | null;
  alt: string;
  className?: string;
}

export function ProviderIcon({
  providerId,
  alt,
  className = "size-4 rounded-sm",
}: ProviderIconProps) {
  const src = getProviderIconSrc(providerId);
  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
