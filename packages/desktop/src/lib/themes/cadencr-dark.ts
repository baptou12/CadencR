import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";
import { NO_TEXTURE } from "./chrome";

/**
 * CadencR Dark — the Emerald Reserve brand default. A near-black sidebar rail
 * frames a lighter graphite workspace; jewel emerald carries primary action
 * while vibrant semantic colors keep tools, syntax, and diffs scannable.
 *
 * CSS variables live in `theme-cadencr.css` under
 * `:root[data-theme="cadencr-dark"]` (also bound to the bare `:root` as the
 * first-paint default); this module carries the xterm palette and swatch.
 */
export const CADENCR_DARK_THEME: ThemeDefinition = {
  id: "cadencr-dark",
  label: "CadencR Dark",
  appearance: "dark",
  logo: CADENCR_THEME_LOGOS.dark,
  // The instrument-case shape: the page tucks into the sidebar rail, and pane
  // tabs are a segmented control rather than an underline. Carried as data so
  // a theme duplicated from this one is still shaped like it.
  chrome: { chassis: "rail", tabs: "segmented", texture: NO_TEXTURE },
  swatch: {
    background: "#131416",
    foreground: "#eff0f2",
    primary: "#2db47d",
    accent: "#a7a9ad",
  },
  xterm: {
    background: "#08090b",
    foreground: "#eff0f2",
    cursor: "#2db47d",
    cursorAccent: "#08090b",
    selectionBackground: "#12372a",
    selectionForeground: "#eff0f2",
    selectionInactiveBackground: "#10271f",
    black: "#1a1b1d",
    red: "#ec707b",
    green: "#8bcf67",
    yellow: "#e2b64d",
    blue: "#6d9bec",
    magenta: "#de7ca7",
    cyan: "#52bfd0",
    white: "#c6c8cc",
    brightBlack: "#6e7176",
    brightRed: "#ff8a94",
    brightGreen: "#a6e47f",
    brightYellow: "#f2cd68",
    brightBlue: "#8db3ff",
    brightMagenta: "#f096bd",
    brightCyan: "#73d7e5",
    brightWhite: "#eff0f2",
  },
};
