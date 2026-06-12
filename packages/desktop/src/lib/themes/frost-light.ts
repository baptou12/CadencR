import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Frost Light — the bright counterpart to Frost Dark: classic white-glass
 * panels floating over a pale, slow-drifting field of azure/cyan halos, with a
 * deepened azure accent for contrast on the luminous background. Glass mechanics
 * live in `theme-frost.css` under `:root[data-theme="frost-light"]`; this module
 * carries the xterm palette plus a swatch for the settings picker.
 *
 * As with Frost Dark, the xterm background stays SOLID — the live terminal can't
 * blur a backdrop, so it uses a cool near-white surface rather than a
 * translucent one.
 */
export const FROST_LIGHT_THEME: ThemeDefinition = {
  id: "frost-light",
  label: "Frost Light",
  appearance: "light",
  logo: CADENCR_THEME_LOGOS.light,
  swatch: {
    background: "#eef3fa",
    foreground: "#2a3142",
    primary: "#2f6fd0",
    accent: "#1f7d9c",
  },
  xterm: {
    // Solid fallback. In the Frost themes the live `.xterm-viewport` is forced
    // transparent via CSS (see theme-frost.css) so the frosted terminal panel
    // (`--terminal-bg`) and the ambient gradient show through; xterm's DOM
    // renderer composites a themed background onto black, so a transparent
    // value here would just collapse to black instead.
    background: "#eef3fa",
    foreground: "#2a3142",
    cursor: "#2f6fd0",
    cursorAccent: "#eef3fa",
    selectionBackground: "#d4e2f5",
    selectionForeground: "#2a3142",
    selectionInactiveBackground: "#e0e9f6",
    black: "#3a4255",
    red: "#c2384a",
    green: "#2f8a5b",
    yellow: "#9a7a10",
    blue: "#2f6fd0",
    magenta: "#7a4fc0",
    cyan: "#1f7d9c",
    white: "#5a6478",
    brightBlack: "#6b7488",
    brightRed: "#d24d5e",
    brightGreen: "#3a9d6a",
    brightYellow: "#ab8a1c",
    brightBlue: "#3f7fe0",
    brightMagenta: "#8a5fd0",
    brightCyan: "#2a8db0",
    brightWhite: "#2a3142",
  },
};
