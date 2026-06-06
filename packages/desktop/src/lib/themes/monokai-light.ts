import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Monokai Light — the light counterpart to Monokai: a warm near-white paper
 * with Monokai's syntax accents deepened for legibility on a light surface.
 *
 * Same UI treatment as Aurora / One Light (block / chip / terminal patterns).
 * The colorful Monokai accents stay in the code surfaces (editor / diff /
 * terminal); the UI chrome is neutral with a deepened cyan/blue `--primary`,
 * so the app doesn't read as a pink/purple theme. CSS variables live in
 * `theme.css` under `:root[data-theme="monokai-light"]`; this module only
 * carries the xterm palette and a small swatch for the settings picker.
 */
export const MONOKAI_LIGHT_THEME: ThemeDefinition = {
  id: "monokai-light",
  label: "Monokai Light",
  appearance: "light",
  logo: CADENCR_THEME_LOGOS.light,
  swatch: {
    background: "#faf9f5",
    foreground: "#3a3a32",
    primary: "#0089b3",
    accent: "#5a8a00",
  },
  xterm: {
    background: "#faf9f5",
    foreground: "#3a3a32",
    cursor: "#3a3a32",
    cursorAccent: "#faf9f5",
    selectionBackground: "#e3e1d8",
    selectionForeground: "#3a3a32",
    selectionInactiveBackground: "#eceae1",
    black: "#3a3a32",
    red: "#d4006a",
    green: "#5a8a00",
    yellow: "#8a7400",
    blue: "#0089b3",
    magenta: "#7c3aed",
    cyan: "#0a8a8a",
    white: "#a8a497",
    brightBlack: "#6f6b5e",
    brightRed: "#d4006a",
    brightGreen: "#5a8a00",
    brightYellow: "#8a7400",
    brightBlue: "#0089b3",
    brightMagenta: "#7c3aed",
    brightCyan: "#0a8a8a",
    brightWhite: "#3a3a32",
  },
};
