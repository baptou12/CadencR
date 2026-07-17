import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * CadencR Light — the Emerald Reserve system-follow default. A cool-gray rail
 * sits behind a neutral-white workspace; deep emerald keeps primary controls
 * premium and accessible while functional colors stay vivid rather than pastel.
 *
 * CSS variables live in `theme-cadencr.css` under
 * `:root[data-theme="cadencr-light"]`; this module carries the xterm palette
 * and swatch.
 */
export const CADENCR_LIGHT_THEME: ThemeDefinition = {
  id: "cadencr-light",
  label: "CadencR Light",
  appearance: "light",
  logo: CADENCR_THEME_LOGOS.light,
  swatch: {
    background: "#fafafb",
    foreground: "#222429",
    primary: "#087653",
    accent: "#60636a",
  },
  xterm: {
    background: "#f4f5f7",
    foreground: "#222429",
    cursor: "#087653",
    cursorAccent: "#ffffff",
    selectionBackground: "#d8eae3",
    selectionForeground: "#222429",
    selectionInactiveBackground: "#e6f1ed",
    black: "#222429",
    red: "#d12d49",
    green: "#3d7d14",
    yellow: "#966c00",
    blue: "#1d5ed8",
    magenta: "#b52b70",
    cyan: "#007f9b",
    white: "#95989f",
    brightBlack: "#60636a",
    brightRed: "#e43f59",
    brightGreen: "#4b921c",
    brightYellow: "#a87900",
    brightBlue: "#2a6eea",
    brightMagenta: "#c43b80",
    brightCyan: "#0092af",
    brightWhite: "#222429",
  },
};
