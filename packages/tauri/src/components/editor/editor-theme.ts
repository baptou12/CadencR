import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

// Cadence uses Dracula palette variables defined in index.css
// We map them to hex values here since CM6 themes can't use CSS vars directly.
const PALETTE = {
  bg: "#1e2030", // slightly darker than drac-bg for editor
  bgSelected: "#44475a", // drac-selection
  fg: "#f8f8f2", // drac-fg
  comment: "#6272a4", // drac-comment
  cyan: "#8be9fd", // drac-cyan
  green: "#50fa7b", // drac-green
  orange: "#ffb86c", // drac-orange
  pink: "#ff79c6", // drac-pink
  purple: "#bd93f9", // drac-purple
  red: "#ff5555", // drac-red
  yellow: "#f1fa8c", // drac-yellow
  border: "#383a59",
  cursor: "#bd93f9",
  lineHighlight: "#2a2c3e",
  gutterBg: "#1e2030",
  gutterFg: "#6272a4",
  selectionBg: "#44475a",
};

const cadenceTheme = EditorView.theme(
  {
    "&": {
      color: PALETTE.fg,
      backgroundColor: PALETTE.bg,
      height: "100%",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    },
    ".cm-content": { caretColor: PALETTE.cursor },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: PALETTE.cursor },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: PALETTE.selectionBg,
    },
    ".cm-panels": { backgroundColor: PALETTE.bg, color: PALETTE.fg },
    ".cm-activeLine": { backgroundColor: PALETTE.lineHighlight },
    ".cm-gutters": {
      backgroundColor: PALETTE.gutterBg,
      color: PALETTE.gutterFg,
      border: "none",
      borderRight: `1px solid ${PALETTE.border}`,
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 4px" },
    ".cm-activeLineGutter": { backgroundColor: PALETTE.lineHighlight },
    ".cm-foldPlaceholder": {
      backgroundColor: "transparent",
      border: "none",
      color: PALETTE.comment,
    },
    ".cm-tooltip": {
      border: `1px solid ${PALETTE.border}`,
      backgroundColor: PALETTE.bg,
    },
    ".cm-tooltip .cm-tooltip-arrow:before": { borderTopColor: PALETTE.border },
    ".cm-tooltip .cm-tooltip-arrow:after": { borderTopColor: PALETTE.bg },
    ".cm-tooltip-autocomplete": {
      "& > ul > li[aria-selected]": { backgroundColor: PALETTE.bgSelected, color: PALETTE.fg },
    },
    ".cm-matchingBracket": { color: PALETTE.green, fontWeight: "bold" },
  },
  { dark: true },
);

const cadenceHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: PALETTE.pink },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: PALETTE.fg },
  { tag: [t.function(t.variableName), t.labelName], color: PALETTE.green },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: PALETTE.purple },
  { tag: [t.definition(t.name), t.separator], color: PALETTE.fg },
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
    color: PALETTE.cyan,
  },
  {
    tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)],
    color: PALETTE.pink,
  },
  { tag: [t.meta, t.comment], color: PALETTE.comment, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: PALETTE.cyan, textDecoration: "underline" },
  { tag: t.heading, fontWeight: "bold", color: PALETTE.purple },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: PALETTE.orange },
  { tag: [t.processingInstruction, t.string, t.inserted], color: PALETTE.yellow },
  { tag: t.invalid, color: PALETTE.red },
]);

const cadenceDiffTheme = EditorView.theme(
  {
    // Unified merge view: deleted lines shown above current text
    ".cm-mergeView & .cm-deletedChunk": {
      backgroundColor: `${PALETTE.red}15`,
    },
    ".cm-mergeView & .cm-insertedLine": {
      backgroundColor: `${PALETTE.green}15`,
    },
    ".cm-mergeView & .cm-deletedLine": {
      backgroundColor: `${PALETTE.red}15`,
    },
    ".cm-mergeView & .cm-changedLine .cm-deletedText": {
      backgroundColor: `${PALETTE.red}30`,
      textDecoration: "none",
    },
    ".cm-mergeView & .cm-changedLine .cm-insertedText": {
      backgroundColor: `${PALETTE.green}30`,
      textDecoration: "none",
    },
    // Override CodeMirror's default 2px bottom gradient underline on changed text
    "&.cm-merge-b .cm-changedText, &.cm-merge-a .cm-changedText": {
      background: "none",
    },
    // Change gutter markers
    ".cm-mergeView & .cm-changeGutter": {
      width: "3px",
      paddingLeft: "0",
    },
    // Merge controls (accept/reject buttons) — hidden in read-only mode
    ".cm-mergeView & .cm-merge-revert": {
      display: "none",
    },
    // Side-by-side MergeView
    ".cm-mergeView": {
      height: "100%",
    },
    ".cm-mergeView .cm-mergeViewEditor": {
      height: "100%",
    },
  },
  { dark: true },
);

export const DIFF_PALETTE = PALETTE;

export const cadenceEditorTheme: Extension[] = [
  cadenceTheme,
  syntaxHighlighting(cadenceHighlightStyle),
];

export const cadenceDiffExtensions: Extension[] = [
  cadenceTheme,
  syntaxHighlighting(cadenceHighlightStyle),
  cadenceDiffTheme,
];
