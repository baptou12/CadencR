import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

function writeEditorText(text: string): void {
  const root = $getRoot();
  root.clear();

  const lines = text.split("\n");
  for (const line of lines) {
    const paragraph = $createParagraphNode();
    if (line.length > 0) {
      paragraph.append($createTextNode(line));
    }
    root.append(paragraph);
  }

  root.getLastChild()?.selectEnd();
}

export function getEditorText(): string {
  const root = $getRoot();
  const children = root.getChildren();
  if (children.length === 0) return "";
  return children.map((child: LexicalNode) => child.getTextContent()).join("\n");
}

export function initializeEditorText(text: string): void {
  writeEditorText(text);
}

/** Replace editor content and place cursor at the end. */
export function setEditorText(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    writeEditorText(text);
  });
}
