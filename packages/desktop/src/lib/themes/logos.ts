import cadencrLogoDark from "../../../assets/cadencr-logo3.svg";
import cadencrLogoLight from "../../../assets/cadencr-logo3-light.svg";
import type { ThemeLogo, ThemeLogoVariant } from "./types";

const CADENCR_ASSET_DISPLAY_SCALE = 1.24;

export const CADENCR_THEME_LOGOS: Record<ThemeLogoVariant, ThemeLogo> = {
  dark: {
    src: cadencrLogoDark,
    alt: "Cadencr",
    variant: "dark",
    displayScale: CADENCR_ASSET_DISPLAY_SCALE,
  },
  light: {
    src: cadencrLogoLight,
    alt: "Cadencr",
    variant: "light",
    displayScale: CADENCR_ASSET_DISPLAY_SCALE,
  },
};
