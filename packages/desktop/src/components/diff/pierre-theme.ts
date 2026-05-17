import { registerCustomTheme } from "@pierre/diffs";
import type { ThemeId } from "@/lib/themes";

const CADENCR_DRACULA_DIFF_THEME = "cadencr-dracula-diff";
const CADENCR_AURORA_DIFF_THEME = "cadencr-aurora-diff";

type PierreThemeName = typeof CADENCR_DRACULA_DIFF_THEME | typeof CADENCR_AURORA_DIFF_THEME;
type PierreThemeRegistration = Parameters<typeof registerCustomTheme>[1] extends () => Promise<
  infer Theme
>
  ? Theme
  : never;

const DRACULA_THEME = {
  name: CADENCR_DRACULA_DIFF_THEME,
  type: "dark",
  colors: {
    "editor.background": "#1e2030",
    "editor.foreground": "#f8f8f2",
    "editor.lineHighlightBackground": "#2a2c3e",
    "editor.selectionBackground": "#44475a",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#6272a4", fontStyle: "italic" },
    },
    { scope: ["keyword", "storage", "storage.type"], settings: { foreground: "#ff79c6" } },
    { scope: ["string", "constant.other.symbol"], settings: { foreground: "#f1fa8c" } },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#ffb86c" },
    },
    {
      scope: ["entity.name.function", "support.function", "variable.language"],
      settings: { foreground: "#50fa7b" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#8be9fd" },
    },
    {
      scope: ["entity.name.tag", "support.class", "variable.other.constant"],
      settings: { foreground: "#bd93f9" },
    },
    { scope: ["invalid", "markup.deleted"], settings: { foreground: "#ff5555" } },
    { scope: ["markup.inserted"], settings: { foreground: "#50fa7b" } },
  ],
} satisfies PierreThemeRegistration;

const AURORA_THEME = {
  name: CADENCR_AURORA_DIFF_THEME,
  type: "light",
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#2f2438",
    "editor.lineHighlightBackground": "#f3eef8",
    "editor.selectionBackground": "#ded1f0",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#746986", fontStyle: "italic" },
    },
    { scope: ["keyword", "storage", "storage.type"], settings: { foreground: "#a01872" } },
    { scope: ["string", "constant.other.symbol"], settings: { foreground: "#8a6500" } },
    {
      scope: ["constant.numeric", "constant.language", "support.constant"],
      settings: { foreground: "#9b5f00" },
    },
    {
      scope: ["entity.name.function", "support.function", "variable.language"],
      settings: { foreground: "#1f7a42" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#126a80" },
    },
    {
      scope: ["entity.name.tag", "support.class", "variable.other.constant"],
      settings: { foreground: "#6a32be" },
    },
    { scope: ["invalid", "markup.deleted"], settings: { foreground: "#b42318" } },
    { scope: ["markup.inserted"], settings: { foreground: "#1f7a42" } },
  ],
} satisfies PierreThemeRegistration;

let registered = false;

export function ensurePierreThemesRegistered(): void {
  if (registered) return;
  registerCustomTheme(CADENCR_DRACULA_DIFF_THEME, () => Promise.resolve(DRACULA_THEME));
  registerCustomTheme(CADENCR_AURORA_DIFF_THEME, () => Promise.resolve(AURORA_THEME));
  registered = true;
}

export function getPierreThemeName(themeId: ThemeId): PierreThemeName {
  return themeId === "aurora" ? CADENCR_AURORA_DIFF_THEME : CADENCR_DRACULA_DIFF_THEME;
}
