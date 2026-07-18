import { getProviderMetadata, type ProviderIconVariant } from "./providers";
import { cn } from "./utils";

export function getProviderIconSrc(
  providerId?: string | null,
  variant: ProviderIconVariant = "color",
): string | null {
  return getProviderMetadata(providerId, null, variant)?.iconSrc ?? null;
}

interface ProviderIconProps {
  providerId?: string | null;
  alt: string;
  className?: string;
  /** Color logos for pickers; mono silhouettes for compact chrome. */
  variant?: ProviderIconVariant;
}

export function ProviderIcon({
  providerId,
  alt,
  className = "size-4 rounded-sm",
  variant = "color",
}: ProviderIconProps) {
  const src = getProviderIconSrc(providerId, variant);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={cn(
        className,
        // Mono assets are black-on-transparent. Invert for Cadencr dark themes
        // via `data-appearance` (not Tailwind `dark:`, which tracks OS preference).
        variant === "mono" && "provider-icon-mono opacity-80",
      )}
    />
  );
}
