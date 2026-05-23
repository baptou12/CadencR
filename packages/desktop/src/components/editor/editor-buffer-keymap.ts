/**
 * Editor buffer keymap. Mounts CodeMirror's autocomplete / fold / tab
 * indentation keymaps and the cherry-picked search commands the registry
 * documents under the `editor-buffer` scope.
 *
 * Why a single extension instead of mounting each keymap inline in
 * `CodeMirrorEditor`:
 *  – the chord-to-action mapping lives next to the registry entries in
 *    `lib/shortcuts/entries.ts`, so it's grep-able from one place;
 *  – `Prec.highest` wraps the cherry-picked bindings so they win over the
 *    `defaultKeymap` (which already covers add-cursor, delete-line, etc.)
 *    and over our app-level shortcuts (which guard against firing while
 *    `.cm-editor` has focus — see `lib/shortcuts/dom-targets.ts`);
 *  – we deliberately do NOT mount the full `searchKeymap`. Cadencr uses a
 *    custom search panel; the built-in panel would replace it.
 */
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  addCursorAbove,
  addCursorBelow,
  deleteLine,
  indentLess,
  insertTab,
  toggleComment,
} from "@codemirror/commands";
import { foldKeymap } from "@codemirror/language";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";

/**
 * Build the editor-buffer keymap extension.
 *
 * The bindings are static — there is no per-mount configuration — but we
 * keep this as a builder so future per-language toggles (e.g. disabling
 * comment toggle in markdown front-matter) have a hook to land on.
 */
export function editorBufferKeymap(): Extension {
  return [
    // Autocomplete state + Ctrl-Space etc. Without `autocompletion()` the
    // completion-keymap bindings are no-ops; LSP completion is wired in
    // `useLsp` via `serverCompletion()` which feeds into the same state.
    autocompletion({ activateOnTyping: false }),
    Prec.highest(
      keymap.of([
        ...completionKeymap,
        ...foldKeymap,
        // Tab inserts a literal tab character when no selection is active;
        // multi-line selections still indent. Shift-Tab dedents. We bind
        // these explicitly (instead of mounting `indentWithTab`) so a
        // single Tab does NOT re-indent the entire current line.
        { key: "Tab", run: insertTab, preventDefault: true },
        { key: "Shift-Tab", run: indentLess, preventDefault: true },

        // ── Editor-buffer scope entries (registry: `editor-*`) ──────────
        // `defaultKeymap` already binds Mod-Alt-Arrow* and Mod-D-equivalents
        // in some flavors, but rebinding them here at higher precedence
        // makes the chord explicit, future-proof, and survives an app-level
        // shortcut sneaking in with a colliding chord.
        { key: "Mod-/", run: toggleComment, preventDefault: true },
        // ⌘K (was ⌘⇧K): delete the current line. The global command
        // palette moved to ⌘⇧P so ⌘K is available here, matching the
        // VS Code / Sublime convention.
        { key: "Mod-k", run: deleteLine, preventDefault: true },
        { key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
        { key: "Mod-Shift-l", run: selectSelectionMatches, preventDefault: true },
        { key: "Mod-Alt-ArrowUp", run: addCursorAbove, preventDefault: true },
        { key: "Mod-Alt-ArrowDown", run: addCursorBelow, preventDefault: true },
      ]),
    ),
  ];
}
