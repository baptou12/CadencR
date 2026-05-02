import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";
import { createTheme } from "@uiw/codemirror-themes";

/**
 * CodeMirror theme. Driven entirely by CSS variables defined in `index.css`
 * under `:root[data-theme="<id>"]` blocks — switching the document's
 * `data-theme` attribute live re-skins every mounted editor without a
 * remount or compartment reconfigure.
 *
 * All Cadencr themes ship a dark code surface (Aurora keeps it dark on
 * purpose for legibility), so the CodeMirror `dark` flag is fixed to `true`.
 * If a future theme inverts that, replace this static extension with a
 * hook + compartment.
 */

const cadencrTheme = createTheme({
  theme: "dark",
  settings: {
    background: "var(--editor-bg)",
    foreground: "var(--editor-fg)",
    caret: "var(--editor-cursor)",
    selection: "var(--editor-selection-bg)",
    selectionMatch: "var(--editor-selection-bg-soft)",
    lineHighlight: "var(--editor-line-highlight)",
    gutterBackground: "var(--editor-gutter-bg)",
    gutterForeground: "var(--editor-gutter-fg)",
    gutterBorder: "var(--editor-border)",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: "13px",
  },
  styles: [
    { tag: t.keyword, color: "var(--editor-pink)" },
    {
      tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
      color: "var(--editor-fg)",
    },
    { tag: [t.function(t.variableName), t.labelName], color: "var(--editor-green)" },
    { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "var(--editor-purple)" },
    { tag: [t.definition(t.name), t.separator], color: "var(--editor-fg)" },
    {
      tag: [
        t.typeName,
        t.className,
        t.number,
        t.changed,
        t.annotation,
        t.modifier,
        t.self,
        t.namespace,
      ],
      color: "var(--editor-cyan)",
    },
    {
      tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
      color: "var(--editor-pink)",
    },
    {
      tag: [t.meta, t.comment],
      color: "var(--editor-comment)",
      fontStyle: "italic",
    },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: "var(--editor-cyan)", textDecoration: "underline" },
    { tag: t.heading, fontWeight: "bold", color: "var(--editor-purple)" },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: "var(--editor-orange)" },
    { tag: [t.processingInstruction, t.string, t.inserted], color: "var(--editor-yellow)" },
    { tag: t.invalid, color: "var(--editor-red)" },
  ],
});

/** Editor chrome that createTheme doesn't cover — height, panels, tooltip,
 *  autocomplete, matching brackets. CSS-var-driven so it tracks the theme. */
const cadencrChromeTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
    },
    ".cm-panels": {
      backgroundColor: "var(--editor-bg)",
      color: "var(--editor-fg)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--editor-comment)",
    },
    ".cm-tooltip": {
      border: "1px solid var(--editor-border)",
      backgroundColor: "var(--editor-bg)",
    },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: "var(--editor-border)" },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: "var(--editor-bg)" },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": {
        backgroundColor: "var(--editor-selection-bg)",
        color: "var(--editor-fg)",
      },
    },
    ".cm-matchingBracket": { color: "var(--editor-green)", fontWeight: "bold" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
  },
  { dark: true },
);

/** Diff/merge-specific theme — uses CSS-var-driven decoration colors. */
const cadencrDiffTheme = EditorView.theme(
  {
    ".cm-mergeView & .cm-deletedChunk": {
      backgroundColor: "var(--diff-del-bg)",
    },
    ".cm-mergeView & .cm-insertedLine": {
      backgroundColor: "var(--diff-add-bg)",
    },
    ".cm-mergeView & .cm-deletedLine": {
      backgroundColor: "var(--diff-del-bg)",
    },
    ".cm-mergeView & .cm-changedLine .cm-deletedText": {
      backgroundColor: "var(--diff-del-bg-strong)",
      textDecoration: "none",
    },
    ".cm-mergeView & .cm-changedLine .cm-insertedText": {
      backgroundColor: "var(--diff-add-bg-strong)",
      textDecoration: "none",
    },
    // Override CodeMirror's default 2px bottom gradient underline on changed text
    "&.cm-merge-b .cm-changedText, &.cm-merge-a .cm-changedText": {
      background: "none",
    },
    ".cm-mergeView & .cm-changeGutter": {
      width: "3px",
      paddingLeft: "0",
    },
    // "X unchanged lines" placeholder produced by `collapseUnchanged`. Without
    // an explicit rule, CodeMirror falls back to its base style (black bg /
    // white text) which ignores the active theme entirely.
    ".cm-mergeView & .cm-collapsedLines, & .cm-collapsedLines": {
      backgroundColor: "var(--editor-line-highlight)",
      color: "var(--editor-comment)",
      borderTop: "1px solid var(--editor-border)",
      borderBottom: "1px solid var(--editor-border)",
      padding: "4px 10px",
    },
    ".cm-mergeView & .cm-collapsedLines:hover, & .cm-collapsedLines:hover": {
      backgroundColor: "var(--editor-selection-bg-soft)",
      color: "var(--editor-fg)",
    },
    // Merge controls (accept/reject buttons) — hidden in read-only mode
    ".cm-mergeView & .cm-merge-revert": {
      display: "none",
    },
    ".cm-mergeView": {
      height: "100%",
    },
    ".cm-mergeView .cm-mergeViewEditor": {
      height: "100%",
    },
  },
  { dark: true },
);

export const cadencrEditorTheme: Extension[] = [cadencrTheme, cadencrChromeTheme];

export const cadencrDiffExtensions: Extension[] = [
  cadencrTheme,
  cadencrChromeTheme,
  cadencrDiffTheme,
];
