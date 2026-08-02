import type { ThemeAppearance, ThemeDefinition } from "./types";
import type { ThemeCssVars } from "./tokens";

/**
 * Runtime injection of a theme's token values.
 *
 * Themes that carry their tokens as data (`ThemeDefinition.cssVars`) get them
 * written into a single `<style>` element as a real CSS rule —
 * `:root[data-theme="<id>"] { --token: value; … }` — rather than as inline
 * styles on `<html>`. That keeps the cascade *identical* to the stylesheet
 * blocks the first-party themes used to live in: same selector, same
 * specificity, still overridable by the more specific rules in
 * `theme-frost.css` & friends, and still absent when `data-theme` says
 * otherwise. Inline styles would win over everything and quietly change
 * behavior.
 *
 * The packaged CSP already allows `style-src 'unsafe-inline'`, so this needs no
 * CSP change.
 */

const STYLE_ELEMENT_ID = "cadencr-theme-vars";

/**
 * Characters that would let a token *value* escape its declaration and inject
 * arbitrary rules. Values are already validated as CSS colors by the backend
 * before a theme is allowed to apply; this is the structural backstop that
 * makes injection safe even if that gate is ever bypassed (a hand-seeded
 * localStorage cache, a future import path).
 */
const UNSAFE_VALUE = /[{}<>;@\\]|\/\*/;

export function isSafeTokenValue(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !UNSAFE_VALUE.test(value);
}

function buildRule(themeId: string, cssVars: ThemeCssVars, appearance: ThemeAppearance): string {
  const declarations = Object.entries(cssVars)
    .filter(([, value]) => isSafeTokenValue(value))
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
  // `color-scheme` comes from the theme's declared appearance rather than a
  // token, so form controls, scrollbars and the native UA palette follow along.
  return `:root[data-theme="${themeId}"] {\n  color-scheme: ${appearance};\n${declarations}\n}\n`;
}

/**
 * Write (or clear) the injected token rule. Idempotent: re-injecting the same
 * theme rewrites identical text, and a theme without `cssVars` empties the
 * element so a previously-injected theme can't leak into it.
 */
export function injectThemeCssVars(theme: ThemeDefinition): void {
  if (typeof document === "undefined") return;
  const css = theme.cssVars ? buildRule(theme.id, theme.cssVars, theme.appearance) : "";
  let element = document.getElementById(STYLE_ELEMENT_ID);
  if (!element) {
    if (css === "") return;
    element = document.createElement("style");
    element.id = STYLE_ELEMENT_ID;
    // Prepended to <head> so the app stylesheets — which carry the
    // theme-family overrides — still win on equal specificity, exactly as when
    // these values lived in `theme.css`.
    document.head.prepend(element);
  }
  if (element.textContent !== css) element.textContent = css;
}
