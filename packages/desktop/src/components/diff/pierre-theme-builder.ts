import { registerCustomTheme } from "@pierre/diffs";

export type PierreThemeRegistration = Parameters<
  typeof registerCustomTheme
>[1] extends () => Promise<infer Theme>
  ? Theme
  : never;

/**
 * Shared TextMate scope groups for Pierre diff themes — kept in one place so
 * per-theme palettes only need to declare hex values, not repeat the scope
 * literals. Order is meaningful only insofar as it mirrors the TextMate
 * convention (comment → keyword → string → …).
 */
const TOKEN_SCOPES = [
  { key: "comment", scope: ["comment", "punctuation.definition.comment"], italic: true },
  { key: "keyword", scope: ["keyword", "storage", "storage.type"] },
  { key: "string", scope: ["string", "constant.other.symbol"] },
  { key: "number", scope: ["constant.numeric", "constant.language", "support.constant"] },
  { key: "function", scope: ["entity.name.function", "support.function", "variable.language"] },
  { key: "type", scope: ["entity.name.type", "entity.name.class", "support.type"] },
  { key: "tag", scope: ["entity.name.tag", "support.class", "variable.other.constant"] },
  { key: "deleted", scope: ["invalid", "markup.deleted"] },
  { key: "inserted", scope: ["markup.inserted"] },
] as const satisfies ReadonlyArray<{
  key: string;
  scope: readonly string[];
  italic?: boolean;
}>;

type TokenKey = (typeof TOKEN_SCOPES)[number]["key"];
export type Palette = Record<TokenKey, string>;

export interface EditorColors {
  background: string;
  foreground: string;
  lineHighlight: string;
  selection: string;
}

export function buildPierreTheme(
  // `string`, not the `PierreThemeName` union: that union is built from the
  // name constants in pierre-theme.ts, which imports this module — typing it
  // here would create an import cycle. Call sites still pass the branded
  // constants, so the theme names stay constrained at the call boundary.
  name: string,
  type: "dark" | "light",
  editor: EditorColors,
  palette: Palette,
): PierreThemeRegistration {
  return {
    name,
    type,
    colors: {
      "editor.background": editor.background,
      "editor.foreground": editor.foreground,
      "editor.lineHighlightBackground": editor.lineHighlight,
      "editor.selectionBackground": editor.selection,
    },
    tokenColors: TOKEN_SCOPES.map((entry) => {
      const italic = "italic" in entry && entry.italic;
      return {
        scope: [...entry.scope],
        settings: italic
          ? { foreground: palette[entry.key], fontStyle: "italic" }
          : { foreground: palette[entry.key] },
      };
    }),
  };
}
