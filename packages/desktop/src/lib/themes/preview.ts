import type { ThemeDocument } from "@/api/generated";
import { injectThemeCssVars, removeInjectedCssVars } from "./inject";
import { toThemeDefinition, userThemeId } from "./user-theme";

/**
 * Painting the app with a theme that isn't saved.
 *
 * The theme studio has to show an edit *as it is typed*, before the file is
 * written and whether or not the theme is the selected one. That can't go
 * through the normal apply path: that path is keyed on the persisted selection,
 * and re-pointing it at a draft would mean an unsaved — possibly half-typed —
 * theme became the user's actual theme, surviving a reload.
 *
 * So a preview is a second, parallel injection: its own `<style>` element and
 * its own `data-theme` value, layered over the real one. Clearing it restores
 * the attribute the document had when the preview started, which is what makes
 * "cancel" and "close the dialog" instant and total — nothing was persisted, so
 * nothing has to be undone.
 */

const PREVIEW_STYLE_ELEMENT_ID = "cadencr-theme-preview";

/**
 * The `data-theme` value a preview paints under. Underscores can't survive
 * `slugify`, so no real theme id can ever collide with it — which matters
 * because a collision would put two rules with the same selector in two
 * elements and let insertion order decide the winner.
 */
const PREVIEW_THEME_ID = userThemeId("__draft__");

interface PreviousAppearance {
  theme: string | undefined;
  appearance: string | undefined;
}

/** Captured on the first apply, not on every one: re-previewing after each
 *  keystroke must not snapshot the preview's own attribute values. */
let previous: PreviousAppearance | null = null;

/** Paint the document with `document_`. Safe to call on every keystroke. */
export function applyThemePreview(document_: ThemeDocument): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  previous ??= { theme: root.dataset.theme, appearance: root.dataset.appearance };
  // Injected before the attribute flips, so the rule is in the stylesheet by
  // the time the selector starts matching — otherwise the first preview frame
  // paints with no tokens at all.
  injectThemeCssVars(toThemeDefinition("__draft__", document_), PREVIEW_STYLE_ELEMENT_ID);
  root.dataset.theme = PREVIEW_THEME_ID;
  root.dataset.appearance = document_.appearance;
}

/** Restore the theme the document had before the preview started. */
export function clearThemePreview(): void {
  if (typeof document === "undefined") return;
  removeInjectedCssVars(PREVIEW_STYLE_ELEMENT_ID);
  const root = document.documentElement;
  if (previous) {
    restoreDataset(root, "theme", previous.theme);
    restoreDataset(root, "appearance", previous.appearance);
    previous = null;
  }
}

function restoreDataset(root: HTMLElement, key: "theme" | "appearance", value?: string): void {
  if (value === undefined) delete root.dataset[key];
  else root.dataset[key] = value;
}

/** Whether a preview currently owns `data-theme`. */
export function isThemePreviewActive(): boolean {
  return previous !== null;
}

/**
 * Redirect where `clearThemePreview` will land, without disturbing what is on
 * screen.
 *
 * The normal apply path keeps running while a preview is up — every theme file
 * change re-applies the *selected* theme — and letting it write `data-theme`
 * would blank the preview mid-edit. Instead it records the theme it wanted, so
 * closing the studio lands on the current selection rather than a stale one.
 */
export function setThemePreviewFallback(theme: string, appearance: string): void {
  if (previous) previous = { theme, appearance };
}
