import { registerCustomTheme } from "@pierre/diffs";
import type { ThemeId } from "@/lib/themes";
import { buildPierreTheme } from "./pierre-theme-builder";
import {
  CADENCR_AURORA_DIFF_THEME,
  CADENCR_CARBON_OWL_DIFF_THEME,
  CADENCR_CATPPUCCIN_LATTE_DIFF_THEME,
  CADENCR_CATPPUCCIN_MOCHA_DIFF_THEME,
  CADENCR_DARK_DIFF_THEME,
  CADENCR_DRACULA_DIFF_THEME,
  CADENCR_FROST_DARK_DIFF_THEME,
  CADENCR_FROST_LIGHT_DIFF_THEME,
  CADENCR_LIGHT_DIFF_THEME,
  CADENCR_MONOKAI_DIFF_THEME,
  CADENCR_MONOKAI_LIGHT_DIFF_THEME,
  CADENCR_ONE_DARK_DIFF_THEME,
  CADENCR_ONE_LIGHT_DIFF_THEME,
  CADENCR_PAPER_OWL_DIFF_THEME,
  type PierreThemeName,
} from "./pierre-theme-names";

// CadencR Dark / Light — Emerald Reserve's vibrant functional family (see
// theme-cadencr.css). Brand emerald stays out of syntax roles; dedicated hues
// keep inserted/deleted lines and code tokens immediately distinguishable.
const CADENCR_DARK_THEME = buildPierreTheme(
  CADENCR_DARK_DIFF_THEME,
  "dark",
  {
    background: "#08090b",
    foreground: "#eff0f2",
    lineHighlight: "#13181b",
    selection: "#12372a",
  },
  {
    comment: "#6e7176",
    keyword: "#de7ca7",
    string: "#e2b64d",
    number: "#f09a5b",
    function: "#8bcf67",
    type: "#52bfd0",
    tag: "#a88af0",
    deleted: "#ec707b",
    inserted: "#8bcf67",
  },
);

const CADENCR_LIGHT_THEME = buildPierreTheme(
  CADENCR_LIGHT_DIFF_THEME,
  "light",
  {
    background: "#f4f5f7",
    foreground: "#222429",
    lineHighlight: "#e9ebee",
    selection: "#d8eae3",
  },
  {
    comment: "#95989f",
    keyword: "#b52b70",
    string: "#966c00",
    number: "#b85f00",
    function: "#3d7d14",
    type: "#007f9b",
    tag: "#6f42c1",
    deleted: "#d12d49",
    inserted: "#3d7d14",
  },
);

const DRACULA_THEME = buildPierreTheme(
  CADENCR_DRACULA_DIFF_THEME,
  "dark",
  {
    background: "#1e2030",
    foreground: "#f8f8f2",
    lineHighlight: "#2a2c3e",
    selection: "#44475a",
  },
  {
    comment: "#6272a4",
    keyword: "#ff79c6",
    string: "#f1fa8c",
    number: "#ffb86c",
    function: "#50fa7b",
    type: "#8be9fd",
    tag: "#bd93f9",
    deleted: "#ff5555",
    inserted: "#50fa7b",
  },
);

const AURORA_THEME = buildPierreTheme(
  CADENCR_AURORA_DIFF_THEME,
  "light",
  {
    background: "#ffffff",
    foreground: "#2f2438",
    lineHighlight: "#f3eef8",
    selection: "#ded1f0",
  },
  {
    comment: "#746986",
    keyword: "#a01872",
    string: "#8a6500",
    number: "#9b5f00",
    function: "#1f7a42",
    type: "#126a80",
    tag: "#6a32be",
    deleted: "#b42318",
    inserted: "#1f7a42",
  },
);

const ONE_DARK_THEME = buildPierreTheme(
  CADENCR_ONE_DARK_DIFF_THEME,
  "dark",
  {
    background: "#282c34",
    foreground: "#abb2bf",
    lineHighlight: "#2c313a",
    selection: "#3e4451",
  },
  {
    comment: "#5c6370",
    keyword: "#c678dd",
    string: "#98c379",
    number: "#d19a66",
    function: "#61afef",
    type: "#e5c07b",
    tag: "#e06c75",
    deleted: "#e06c75",
    inserted: "#98c379",
  },
);

const ONE_LIGHT_THEME = buildPierreTheme(
  CADENCR_ONE_LIGHT_DIFF_THEME,
  "light",
  {
    background: "#fbfaf8",
    foreground: "#383a42",
    lineHighlight: "#eeece6",
    selection: "#e6e3dd",
  },
  {
    comment: "#a0a1a7",
    keyword: "#a626a4",
    string: "#50a14f",
    number: "#986801",
    function: "#4078f2",
    type: "#c18401",
    tag: "#e45649",
    deleted: "#e45649",
    inserted: "#50a14f",
  },
);

const MONOKAI_THEME = buildPierreTheme(
  CADENCR_MONOKAI_DIFF_THEME,
  "dark",
  {
    background: "#272822",
    foreground: "#f8f8f2",
    lineHighlight: "#3e3d32",
    selection: "#49483e",
  },
  {
    comment: "#75715e",
    keyword: "#f92672",
    string: "#e6db74",
    number: "#ae81ff",
    function: "#a6e22e",
    type: "#66d9ef",
    tag: "#f92672",
    deleted: "#f92672",
    inserted: "#a6e22e",
  },
);

const MONOKAI_LIGHT_THEME = buildPierreTheme(
  CADENCR_MONOKAI_LIGHT_DIFF_THEME,
  "light",
  {
    background: "#faf9f5",
    foreground: "#3a3a32",
    lineHighlight: "#eceae1",
    selection: "#e3e1d8",
  },
  {
    comment: "#9a958a",
    keyword: "#d4006a",
    string: "#8a7400",
    number: "#7c3aed",
    function: "#5a8a00",
    type: "#0089b3",
    tag: "#d4006a",
    deleted: "#d4006a",
    inserted: "#5a8a00",
  },
);

const FROST_DARK_THEME = buildPierreTheme(
  CADENCR_FROST_DARK_DIFF_THEME,
  "dark",
  {
    background: "#141826",
    foreground: "#d9e2ee",
    lineHighlight: "#1e2740",
    selection: "#2a3550",
  },
  {
    comment: "#6f7a93",
    keyword: "#c8a6ff",
    string: "#6fe0a8",
    number: "#f2d98a",
    function: "#6cb6ff",
    type: "#7fd6e8",
    tag: "#ff97a0",
    deleted: "#ff7a85",
    inserted: "#6fe0a8",
  },
);

const FROST_LIGHT_THEME = buildPierreTheme(
  CADENCR_FROST_LIGHT_DIFF_THEME,
  "light",
  {
    background: "#eef3fa",
    foreground: "#2a3142",
    lineHighlight: "#e2ebf7",
    selection: "#d4e2f5",
  },
  {
    comment: "#6b7488",
    keyword: "#7a4fc0",
    string: "#2f8a5b",
    number: "#9a7a10",
    function: "#2f6fd0",
    type: "#1f7d9c",
    tag: "#c2384a",
    deleted: "#c2384a",
    inserted: "#2f8a5b",
  },
);

const CARBON_OWL_THEME = buildPierreTheme(
  CADENCR_CARBON_OWL_DIFF_THEME,
  "dark",
  {
    background: "#1b1d22",
    foreground: "#bbbbbb",
    lineHighlight: "#22262d",
    selection: "#353d49",
  },
  {
    comment: "#6c7689",
    keyword: "#d39e17",
    string: "#37ae6f",
    number: "#c13838",
    function: "#3398db",
    type: "#a15def",
    tag: "#de456b",
    deleted: "#c13838",
    inserted: "#37ae6f",
  },
);

const PAPER_OWL_THEME = buildPierreTheme(
  CADENCR_PAPER_OWL_DIFF_THEME,
  "light",
  {
    background: "#f7f4ec",
    foreground: "#403f53",
    lineHighlight: "#ece7db",
    selection: "#d3e8f8",
  },
  {
    comment: "#7e8595",
    keyword: "#994cc3",
    string: "#08916a",
    number: "#aa0982",
    function: "#4876d6",
    type: "#0c969b",
    tag: "#d3423e",
    deleted: "#d3423e",
    inserted: "#08916a",
  },
);

const CATPPUCCIN_MOCHA_THEME = buildPierreTheme(
  CADENCR_CATPPUCCIN_MOCHA_DIFF_THEME,
  "dark",
  {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    lineHighlight: "#292a3b",
    selection: "#45475a",
  },
  {
    comment: "#7f849c",
    keyword: "#cba6f7",
    string: "#a6e3a1",
    number: "#fab387",
    function: "#89b4fa",
    type: "#f9e2af",
    tag: "#f38ba8",
    deleted: "#f38ba8",
    inserted: "#a6e3a1",
  },
);

const CATPPUCCIN_LATTE_THEME = buildPierreTheme(
  CADENCR_CATPPUCCIN_LATTE_DIFF_THEME,
  "light",
  {
    background: "#eff1f5",
    foreground: "#4c4f69",
    lineHighlight: "#e6e9ef",
    selection: "#acb0be",
  },
  {
    comment: "#7c7f93",
    keyword: "#8839ef",
    string: "#40a02b",
    number: "#fe640b",
    function: "#1e66f5",
    type: "#df8e1d",
    tag: "#d20f39",
    deleted: "#d20f39",
    inserted: "#40a02b",
  },
);

let registered = false;

export function ensurePierreThemesRegistered(): void {
  if (registered) return;
  registerCustomTheme(CADENCR_DARK_DIFF_THEME, () => Promise.resolve(CADENCR_DARK_THEME));
  registerCustomTheme(CADENCR_LIGHT_DIFF_THEME, () => Promise.resolve(CADENCR_LIGHT_THEME));
  registerCustomTheme(CADENCR_DRACULA_DIFF_THEME, () => Promise.resolve(DRACULA_THEME));
  registerCustomTheme(CADENCR_AURORA_DIFF_THEME, () => Promise.resolve(AURORA_THEME));
  registerCustomTheme(CADENCR_ONE_DARK_DIFF_THEME, () => Promise.resolve(ONE_DARK_THEME));
  registerCustomTheme(CADENCR_ONE_LIGHT_DIFF_THEME, () => Promise.resolve(ONE_LIGHT_THEME));
  registerCustomTheme(CADENCR_MONOKAI_DIFF_THEME, () => Promise.resolve(MONOKAI_THEME));
  registerCustomTheme(CADENCR_MONOKAI_LIGHT_DIFF_THEME, () => Promise.resolve(MONOKAI_LIGHT_THEME));
  registerCustomTheme(CADENCR_FROST_DARK_DIFF_THEME, () => Promise.resolve(FROST_DARK_THEME));
  registerCustomTheme(CADENCR_FROST_LIGHT_DIFF_THEME, () => Promise.resolve(FROST_LIGHT_THEME));
  registerCustomTheme(CADENCR_CARBON_OWL_DIFF_THEME, () => Promise.resolve(CARBON_OWL_THEME));
  registerCustomTheme(CADENCR_PAPER_OWL_DIFF_THEME, () => Promise.resolve(PAPER_OWL_THEME));
  registerCustomTheme(CADENCR_CATPPUCCIN_MOCHA_DIFF_THEME, () =>
    Promise.resolve(CATPPUCCIN_MOCHA_THEME),
  );
  registerCustomTheme(CADENCR_CATPPUCCIN_LATTE_DIFF_THEME, () =>
    Promise.resolve(CATPPUCCIN_LATTE_THEME),
  );
  registered = true;
}

export function getPierreThemeName(themeId: ThemeId): PierreThemeName {
  switch (themeId) {
    case "cadencr-dark":
      return CADENCR_DARK_DIFF_THEME;
    case "cadencr-light":
      return CADENCR_LIGHT_DIFF_THEME;
    case "aurora":
      return CADENCR_AURORA_DIFF_THEME;
    case "one-dark":
      return CADENCR_ONE_DARK_DIFF_THEME;
    case "one-light":
      return CADENCR_ONE_LIGHT_DIFF_THEME;
    case "dracula":
      return CADENCR_DRACULA_DIFF_THEME;
    case "monokai":
      return CADENCR_MONOKAI_DIFF_THEME;
    case "monokai-light":
      return CADENCR_MONOKAI_LIGHT_DIFF_THEME;
    case "frost-dark":
      return CADENCR_FROST_DARK_DIFF_THEME;
    case "frost-light":
      return CADENCR_FROST_LIGHT_DIFF_THEME;
    case "carbon-owl":
      return CADENCR_CARBON_OWL_DIFF_THEME;
    case "paper-owl":
      return CADENCR_PAPER_OWL_DIFF_THEME;
    case "catppuccin-mocha":
      return CADENCR_CATPPUCCIN_MOCHA_DIFF_THEME;
    case "catppuccin-latte":
      return CADENCR_CATPPUCCIN_LATTE_DIFF_THEME;
  }
}
