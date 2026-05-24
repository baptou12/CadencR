import type { ThemeDefinition } from "./types";
import { CADENCR_THEME_LOGOS } from "./logos";

/**
 * One Light — Atom's One Light Pro palette, the light counterpart to One Dark.
 *
 * A clean off-white surface with classic syntax accents (red, green, yellow,
 * blue, magenta, cyan) deepened for legibility on white. CSS variables live
 * in `theme.css` under `:root[data-theme="one-light"]`; this module only
 * carries the xterm palette and a small swatch for the settings picker.
 */
export const ONE_LIGHT_THEME: ThemeDefinition = {
  id: "one-light",
  label: "One Light",
  appearance: "light",
  logo: CADENCR_THEME_LOGOS.light,
  swatch: {
    background: "#fbfaf8",
    foreground: "#383a42",
    primary: "#4078f2",
    accent: "#a626a4",
  },
  xterm: {
    background: "#fbfaf8",
    foreground: "#383a42",
    cursor: "#526fff",
    cursorAccent: "#fbfaf8",
    selectionBackground: "#e6e3dd",
    selectionForeground: "#383a42",
    selectionInactiveBackground: "#eeece6",
    black: "#383a42",
    red: "#e45649",
    green: "#50a14f",
    yellow: "#c18401",
    blue: "#4078f2",
    magenta: "#a626a4",
    cyan: "#0184bc",
    white: "#a0a1a7",
    brightBlack: "#696c77",
    brightRed: "#e45649",
    brightGreen: "#50a14f",
    brightYellow: "#986801",
    brightBlue: "#4078f2",
    brightMagenta: "#a626a4",
    brightCyan: "#0184bc",
    brightWhite: "#383a42",
  },
};
