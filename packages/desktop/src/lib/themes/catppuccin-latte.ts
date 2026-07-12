import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Catppuccin Latte — the light flavor of the Catppuccin palette
 * (https://catppuccin.com). Warm off-white base with saturated, high-contrast
 * accents tuned for daylight. Mauve is the signature accent; the terminal
 * cursor is rosewater, per the Catppuccin style guide.
 */
export const CATPPUCCIN_LATTE_THEME: ThemeDefinition = {
  id: "catppuccin-latte",
  label: "Catppuccin Latte",
  appearance: "light",
  logo: CADENCR_THEME_LOGOS.light,
  swatch: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    primary: "#8839ef",
    accent: "#ea76cb",
  },
  xterm: {
    background: "#eff1f5",
    foreground: "#4c4f69",
    cursor: "#dc8a78",
    cursorAccent: "#eff1f5",
    selectionBackground: "#acb0be",
    selectionForeground: "#4c4f69",
    selectionInactiveBackground: "#bcc0cc",
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#df8e1d",
    blue: "#1e66f5",
    magenta: "#ea76cb",
    cyan: "#179299",
    white: "#acb0be",
    brightBlack: "#6c6f85",
    brightRed: "#d20f39",
    brightGreen: "#40a02b",
    brightYellow: "#df8e1d",
    brightBlue: "#1e66f5",
    brightMagenta: "#ea76cb",
    brightCyan: "#179299",
    brightWhite: "#bcc0cc",
  },
};
