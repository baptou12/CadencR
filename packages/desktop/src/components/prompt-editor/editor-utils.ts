import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { parseConversationReferences } from "./conversation-reference";
import { $createConversationReferenceNode } from "./nodes/ConversationReferenceNode";
import { $createShellCommandPrefixNode } from "./nodes/ShellCommandPrefixNode";

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

function writeShellCommandText(text: string): void {
  if (text === "!") {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
    return;
  }

  const lines = text.slice(1).split("\n");
  for (const [index, line] of lines.entries()) {
    const paragraph = $createParagraphNode();
    if (index === 0) paragraph.append($createShellCommandPrefixNode());
    if (line.length > 0) paragraph.append($createTextNode(line));
    $getRoot().append(paragraph);
  }
}

function writeEditorText(text: string, moveSelection = true, shellCommandsEnabled = false): void {
  const root = $getRoot();
  root.clear();

  if (shellCommandsEnabled && text.startsWith("!")) {
    writeShellCommandText(text);
  } else {
    const lines = text.split("\n");
    for (const line of lines) {
      const paragraph = $createParagraphNode();
      appendLineContent(paragraph, line);
      root.append(paragraph);
    }
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

export function initializeEditorText(text: string, shellCommandsEnabled = false): void {
  writeEditorText(text, true, shellCommandsEnabled);
}

/**
 * Replace editor content. Places the cursor at the end by default, which also
 * focuses the editor; pass `moveSelection: false` to set text without focusing.
 */
export function setEditorText(
  editor: LexicalEditor,
  text: string,
  moveSelection = true,
  shellCommandsEnabled = false,
): void {
  editor.update(() => {
    writeEditorText(text, moveSelection, shellCommandsEnabled);
  });
}
