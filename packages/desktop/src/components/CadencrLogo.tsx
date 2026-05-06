import { memo, type ReactElement } from "react";
import { useTheme } from "@/hooks/useTheme";

interface CadencrLogoProps {
  className?: string;
}

function CadencrLogoComponent({ className }: CadencrLogoProps): ReactElement {
  const { theme } = useTheme();

  return (
    <img
      src={theme.logo.src}
      alt={theme.logo.alt}
      className={className}
      style={{ transform: `scale(${theme.logo.displayScale})` }}
    />
  );
}

export const CadencrLogo = memo(CadencrLogoComponent);
