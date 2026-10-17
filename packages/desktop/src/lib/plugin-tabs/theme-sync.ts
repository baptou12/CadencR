import { themeToCss } from "@cadencr/tab-sdk";
import type { ThemeSnapshot } from "@cadencr/tab-sdk/protocol";

import { toastError } from "@/lib/api-errors";
import { desktopBridge } from "@/lib/desktop-bridge";

import { opaqueBackground, readThemeSnapshot } from "./theme-snapshot";

type ThemeListener = (theme: ThemeSnapshot) => void;

let current: ThemeSnapshot | null = null;
let currentKey = "";
let observer: MutationObserver | null = null;
const listeners = new Set<ThemeListener>();

/** The theme guests are given in `hello`. */
export function currentPluginTabTheme(): ThemeSnapshot {
  if (!current) refresh();
  return current ?? { id: "", appearance: "dark", tokens: {} };
}

/** Called with every theme change, after the guests' stylesheet was pushed. */
export function subscribePluginTabTheme(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start following the app theme, once for the whole renderer: push the guest
 * stylesheet + background to the main process now (before any guest opens)
 * and again whenever the theme changes. Idempotent.
 *
 * A theme switch flips `data-theme`/`data-appearance` on `<html>`; editing a
 * user theme rewrites the injected token `<style>` in `<head>` — both are
 * observed; a MutationObserver already batches a burst of mutations into one
 * callback, and the re-read is deduplicated on content. Not tied to animation
 * frames, so a theme change while the window is hidden still reaches guests.
 */
export function ensurePluginTabThemeSync(): void {
  if (observer || typeof MutationObserver === "undefined") {
    if (!current) refresh();
    return;
  }
  refresh();
  observer = new MutationObserver(refresh);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-appearance", "class", "style"],
  });
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
}

function refresh(): void {
  if (typeof document === "undefined") return;
  const theme = readThemeSnapshot();
  const key = JSON.stringify(theme);
  if (key === currentKey) return;
  const changed = current !== null;
  current = theme;
  currentKey = key;
  const background = opaqueBackground(theme.tokens.background ?? "", theme.appearance);
  desktopBridge.pluginTabs
    .setTheme({ css: themeToCss(theme), background })
    .catch((error: unknown) => toastError(error, "Custom tabs could not follow the theme"));
  if (changed) for (const listener of listeners) listener(theme);
}
