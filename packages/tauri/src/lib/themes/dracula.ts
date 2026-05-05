import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Dracula — Cadencr's vibrant dark theme. The current default look.
 *
 * CSS variables for this theme live in `index.css` under
 * `:root[data-theme="dracula"]`; this module only carries values that
 * canvas-based renderers (xterm.js) need explicitly, plus a small swatch for
 * the settings picker.
 */
export const DRACULA_THEME: ThemeDefinition = {
  id: "dracula",
  label: "Dracula",
  appearance: "dark",
  logo: CADENCR_THEME_LOGOS.dark,
  swatch: {
    background: "#282a36",
    foreground: "#f8f8f2",
    primary: "#bd93f9",
    accent: "#ff79c6",
  },
  xterm: {
    background: "#1a1b26",
    foreground: "#c0caf5",
    cursor: "#c0caf5",
    cursorAccent: "#1a1b26",
    selectionBackground: "#33467c",
    selectionForeground: "#c0caf5",
    selectionInactiveBackground: "#283457",
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
};
