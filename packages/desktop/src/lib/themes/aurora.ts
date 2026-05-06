import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * Aurora — a white version of the vibrant Dracula theme.
 *
 * Tailwind tokens mirror the design HTML's `:root[data-theme="light"]` block.
 * Code surface and terminal go light too: the user expects "white theme" to
 * apply everywhere, not just to chrome. ANSI colors are darker variants of
 * Aurora's accent palette so they read against a white canvas.
 */
export const AURORA_THEME: ThemeDefinition = {
  id: "aurora",
  label: "Aurora",
  appearance: "light",
  logo: CADENCR_THEME_LOGOS.light,
  swatch: {
    background: "oklch(0.985 0.004 290)",
    foreground: "oklch(0.205 0.040 285)",
    primary: "oklch(0.55 0.245 295)",
    accent: "oklch(0.60 0.22 350)",
  },
  xterm: {
    background: "#ffffff",
    foreground: "#2c2d3a",
    cursor: "#7c4ed1",
    cursorAccent: "#ffffff",
    selectionBackground: "#d4c4f0",
    selectionForeground: "#2c2d3a",
    selectionInactiveBackground: "#e6dff5",
    black: "#2c2d3a",
    red: "#cd4135",
    green: "#3aa15c",
    yellow: "#bb9233",
    blue: "#3a91a8",
    magenta: "#cf3a87",
    cyan: "#3a91a8",
    white: "#aeaebd",
    brightBlack: "#7d7d8e",
    brightRed: "#e25548",
    brightGreen: "#4dba6f",
    brightYellow: "#d1a544",
    brightBlue: "#4ca5bd",
    brightMagenta: "#e2549c",
    brightCyan: "#4ca5bd",
    brightWhite: "#1f2030",
  },
};
