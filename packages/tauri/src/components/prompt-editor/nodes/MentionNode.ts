import {
  TextNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";

type SerializedMentionNode = Spread<
  { mentionPath: string },
  SerializedTextNode
>;

export class MentionNode extends TextNode {
  __mentionPath: string;

  static getType(): string {
    return "mention";
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__mentionPath, node.__text, node.__key);
  }

  constructor(mentionPath: string, text?: string, key?: NodeKey) {
    super(text ?? `@${mentionPath}`, key);
    this.__mentionPath = mentionPath;
  }

  getMentionPath(): string {
    return this.__mentionPath;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const el = super.createDOM(config);
    el.className =
      "inline-block rounded bg-blue-100 text-blue-800 px-1 text-sm font-medium dark:bg-blue-900/40 dark:text-blue-300";
    el.dataset.mentionPath = this.__mentionPath;
    return el;
  }

  updateDOM(): boolean {
    // Always recreate — styling is static
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.getTextContent();
    element.dataset.mentionPath = this.__mentionPath;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return $createMentionNode(serializedNode.mentionPath, serializedNode.text);
  }

  exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      type: "mention",
      mentionPath: this.__mentionPath,
    };
  }

  getTextContent(): string {
    return `@${this.__mentionPath}`;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  isTextEntity(): boolean {
    return true;
  }
}

export function $createMentionNode(
  mentionPath: string,
  text?: string,
): MentionNode {
  const node = new MentionNode(mentionPath, text);
  node.setMode("token");
  return node;
}

function $isMentionNode(node: LexicalNode): node is MentionNode {
  return node instanceof MentionNode;
}
