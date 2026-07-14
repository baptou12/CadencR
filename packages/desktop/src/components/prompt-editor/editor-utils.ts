import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { parseConversationReferences } from "./conversation-reference";
import { $createConversationReferenceNode } from "./nodes/ConversationReferenceNode";

function appendLineContent(paragraph: ReturnType<typeof $createParagraphNode>, line: string): void {
  const references = parseConversationReferences(line);
  if (references.length === 0) {
    if (line.length > 0) paragraph.append($createTextNode(line));
    return;
  }
  let offset = 0;
  for (const reference of references) {
    if (reference.start > offset)
      paragraph.append($createTextNode(line.slice(offset, reference.start)));
    paragraph.append($createConversationReferenceNode(reference.featureId, reference.label));
    offset = reference.end;
  }
  if (offset < line.length) paragraph.append($createTextNode(line.slice(offset)));
}

function writeEditorText(text: string, moveSelection = true): void {
  const root = $getRoot();
  root.clear();

  const lines = text.split("\n");
  for (const line of lines) {
    const paragraph = $createParagraphNode();
    appendLineContent(paragraph, line);
    root.append(paragraph);
  }

  // `selectEnd()` inside a live `editor.update()` moves the DOM selection into
  // the contenteditable, which focuses it. Callers that populate text without
  // wanting to steal focus (e.g. silent draft restore on phones, where it would
  // pop the on-screen keyboard) pass `moveSelection: false`.
  if (moveSelection) root.getLastChild()?.selectEnd();
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

/**
 * Replace editor content. Places the cursor at the end by default, which also
 * focuses the editor; pass `moveSelection: false` to set text without focusing.
 */
export function setEditorText(editor: LexicalEditor, text: string, moveSelection = true): void {
  editor.update(() => {
    writeEditorText(text, moveSelection);
  });
}
