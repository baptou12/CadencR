/**
 * The library-provided language-feature extensions Cadencr layers on top of
 * the type-checker LSP plugin: hover tooltips and signature help.
 *
 * Both come straight from `@codemirror/lsp-client` — there's no reason to
 * reimplement them, and they resolve the active client via `LSPPlugin.get`,
 * which (because the type checker's plugin is mounted first) targets the type
 * checker, not a linter. Completion is mounted separately in `useLsp` via
 * `serverCompletion()`.
 *
 * Built once at module load and reused so the extension array stays
 * referentially stable across editor re-renders (see frontend-performance
 * rules: memoized extension arrays).
 *
 * `signatureHelp()` binds its own keymap (Cmd/Ctrl+Shift+Space to show,
 * Cmd/Ctrl+Shift+Up/Down to cycle) unless `keymap: false`; we keep the
 * default keymap so signature help is keyboard-reachable.
 */
import type { Extension } from "@codemirror/state";
import { hoverTooltips, signatureHelp } from "@codemirror/lsp-client";

/** Hover tooltips + signature help, mounted on the type-checker client. */
export const lspLanguageFeatures: Extension = [hoverTooltips(), signatureHelp()];
