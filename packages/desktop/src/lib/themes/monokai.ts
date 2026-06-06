import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Monokai — Wimer Hazenberg's classic vivid dark palette adapted to Cadencr's
 * token structure.
 *
 * A warm charcoal-green background with high-saturation syntax accents
 * (pink, green, orange, yellow, cyan, purple). The colorful accents stay in
 * the code surfaces (editor / diff / terminal); the UI chrome is neutral with
 * Monokai's cyan/blue as the brand `--primary`, so the app doesn't read as a
 * pink/purple theme. CSS variables live in `theme.css` under
 * `:root[data-theme="monokai"]`; this module only carries the xterm palette
 * (canvas-rendered, can't read CSS variables) plus a small swatch for the
 * settings picker.
 */
export const MONOKAI_THEME: ThemeDefinition = {
  id: "monokai",
  label: "Monokai",
  appearance: "dark",
  logo: CADENCR_THEME_LOGOS.dark,
  swatch: {
    background: "#272822",
    foreground: "#f8f8f2",
    primary: "#66d9ef",
    accent: "#a6e22e",
  },
  xterm: {
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#272822",
    selectionBackground: "#49483e",
    selectionForeground: "#f8f8f2",
    selectionInactiveBackground: "#3e3d32",
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#e6db74",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",
    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#e6db74",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5",
  },
};
