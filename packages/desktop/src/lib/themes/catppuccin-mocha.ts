import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Catppuccin Mocha — the flagship dark flavor of the Catppuccin palette
 * (https://catppuccin.com). Soothing pastel accents over a deep indigo base.
 * Mauve is the signature accent; the terminal cursor is rosewater, per the
 * Catppuccin style guide.
 */
export const CATPPUCCIN_MOCHA_THEME: ThemeDefinition = {
  id: "catppuccin-mocha",
  label: "Catppuccin Mocha",
  appearance: "dark",
  logo: CADENCR_THEME_LOGOS.dark,
  swatch: {
    background: "#181825",
    foreground: "#cdd6f4",
    primary: "#cba6f7",
    accent: "#f5c2e7",
  },
  // Background sits at mantle to match the darker workspace surface
  // (--terminal-bg / --background); cursorAccent (text under the block cursor)
  // matches so the caret reads cleanly.
  xterm: {
    background: "#181825",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#181825",
    selectionBackground: "#585b70",
    selectionForeground: "#cdd6f4",
    selectionInactiveBackground: "#45475a",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};
