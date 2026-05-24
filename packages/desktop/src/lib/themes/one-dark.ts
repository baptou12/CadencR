import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * One Dark — Atom's One Dark Pro palette adapted to Cadencr's token structure.
 *
 * A balanced, slightly cool dark theme with classic syntax accents
 * (red, green, yellow, blue, magenta, cyan). CSS variables live in
 * `theme.css` under `:root[data-theme="one-dark"]`; this module only carries
 * the xterm palette (canvas-rendered, can't read CSS variables) plus a small
 * swatch for the settings picker.
 */
export const ONE_DARK_THEME: ThemeDefinition = {
  id: "one-dark",
  label: "One Dark",
  appearance: "dark",
  logo: CADENCR_THEME_LOGOS.dark,
  swatch: {
    background: "#282c34",
    foreground: "#abb2bf",
    primary: "#61afef",
    accent: "#c678dd",
  },
  xterm: {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    selectionForeground: "#abb2bf",
    selectionInactiveBackground: "#2c313a",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
};
