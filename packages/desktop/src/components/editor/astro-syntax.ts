import { typescriptLanguage } from "@codemirror/lang-javascript";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { highlightTree, tagHighlighter, tags as t } from "@lezer/highlight";

interface FrontmatterRange {
  openFrom: number;
  openTo: number;
  codeFrom: number;
  codeTo: number;
  closeFrom: number;
  closeTo: number;
}

const ASTRO_HIGHLIGHTER = tagHighlighter([
  { tag: t.keyword, class: "cm-astro-keyword" },
  { tag: [t.string, t.special(t.string)], class: "cm-astro-string" },
  { tag: [t.number, t.bool, t.atom], class: "cm-astro-atom" },
  { tag: [t.variableName, t.definition(t.variableName)], class: "cm-astro-variable" },
  { tag: [t.propertyName, t.definition(t.propertyName)], class: "cm-astro-property" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "cm-astro-function" },
  { tag: [t.typeName, t.className], class: "cm-astro-type" },
  { tag: [t.operator, t.operatorKeyword, t.punctuation], class: "cm-astro-operator" },
  { tag: [t.comment, t.meta], class: "cm-astro-comment" },
  { tag: t.invalid, class: "cm-astro-invalid" },
]);

const delimiterMark = Decoration.mark({ class: "cm-astro-frontmatter-delimiter" });

const astroFrontmatterTheme = EditorView.baseTheme({
  ".cm-astro-frontmatter-delimiter": {
    color: "var(--editor-comment)",
    fontStyle: "italic",
  },
  ".cm-astro-keyword": { color: "var(--editor-pink)" },
  ".cm-astro-string": { color: "var(--editor-yellow)" },
  ".cm-astro-atom": { color: "var(--editor-orange)" },
  ".cm-astro-variable": { color: "var(--editor-fg)" },
  ".cm-astro-property": { color: "var(--editor-cyan)" },
  ".cm-astro-function": { color: "var(--editor-green)" },
  ".cm-astro-type": { color: "var(--editor-cyan)" },
  ".cm-astro-operator": { color: "var(--editor-pink)" },
  ".cm-astro-comment": {
    color: "var(--editor-comment)",
    fontStyle: "italic",
  },
  ".cm-astro-invalid": { color: "var(--editor-red)" },
});

function findFrontmatterRange(source: string): FrontmatterRange | null {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) return null;
  const openTo = source.startsWith("---\r\n") ? 5 : 4;
  const closeMatch = /\r?\n---(?=\r?\n|$)/.exec(source.slice(openTo));
  if (!closeMatch || closeMatch.index < 0) return null;
  const closeFrom = openTo + closeMatch.index + closeMatch[0].indexOf("---");
  const closeTo = closeFrom + 3;
  return {
    openFrom: 0,
    openTo,
    codeFrom: openTo,
    codeTo: openTo + closeMatch.index,
    closeFrom,
    closeTo,
  };
}

function buildAstroDecorations(view: EditorView): DecorationSet {
  const source = view.state.doc.toString();
  const range = findFrontmatterRange(source);
  if (!range) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(range.openFrom, range.openTo, delimiterMark);
  addScriptDecorations(builder, source.slice(range.codeFrom, range.codeTo), range.codeFrom);
  builder.add(range.closeFrom, range.closeTo, delimiterMark);
  addTemplateExpressionDecorations(builder, source, range.closeTo);
  return builder.finish();
}

function addScriptDecorations(
  builder: RangeSetBuilder<Decoration>,
  code: string,
  offset: number,
): void {
  const tree = typescriptLanguage.parser.parse(code);
  highlightTree(tree, ASTRO_HIGHLIGHTER, (from, to, classes) => {
    if (from === to || classes.length === 0) return;
    builder.add(offset + from, offset + to, Decoration.mark({ class: classes }));
  });
}

function addTemplateExpressionDecorations(
  builder: RangeSetBuilder<Decoration>,
  source: string,
  offset: number,
): void {
  let cursor = offset;
  while (cursor < source.length) {
    const open = source.indexOf("{", cursor);
    if (open < 0) return;
    const close = source.indexOf("}", open + 1);
    if (close < 0) return;
    builder.add(open, open + 1, Decoration.mark({ class: "cm-astro-operator" }));
    addScriptDecorations(builder, source.slice(open + 1, close), open + 1);
    builder.add(close, close + 1, Decoration.mark({ class: "cm-astro-operator" }));
    cursor = close + 1;
  }
}

const astroFrontmatterPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildAstroDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (!update.docChanged) return;
      this.decorations = buildAstroDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function astroSyntax(): Extension {
  return [astroFrontmatterTheme, astroFrontmatterPlugin];
}
