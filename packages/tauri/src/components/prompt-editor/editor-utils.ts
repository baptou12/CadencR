import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical";

/** Replace editor content and place cursor at the end. */
export function setEditorText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    const p = $createParagraphNode();
    const textNode = $createTextNode(text);
    p.append(textNode);
    root.append(p);
    textNode.select(text.length, text.length);
  });
}
