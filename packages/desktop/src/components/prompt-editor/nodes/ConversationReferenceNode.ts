import {
  TextNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";
import { serializeConversationReference } from "../conversation-reference";

type SerializedConversationReferenceNode = Spread<
  { featureId: number; label: string },
  SerializedTextNode
>;

export class ConversationReferenceNode extends TextNode {
  __featureId: number;
  __label: string;

  static getType(): string {
    return "conversation-reference";
  }

  static clone(node: ConversationReferenceNode): ConversationReferenceNode {
    return new ConversationReferenceNode(node.__featureId, node.__label, node.__key);
  }

  constructor(featureId: number, label: string, key?: NodeKey) {
    super(`@@${label}`, key);
    this.__featureId = featureId;
    this.__label = label;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.textContent = `@@${this.__label}`;
    element.className =
      "inline-block rounded border border-[var(--chip-fuchsia-fg)]/25 bg-[var(--chip-fuchsia-bg)]/18 px-1 text-sm font-semibold text-[var(--chip-fuchsia-fg)]";
    element.dataset.conversationFeatureId = String(this.__featureId);
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.getTextContent();
    element.dataset.conversationFeatureId = String(this.__featureId);
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  static importJSON(
    serializedNode: SerializedConversationReferenceNode,
  ): ConversationReferenceNode {
    return $createConversationReferenceNode(serializedNode.featureId, serializedNode.label);
  }

  exportJSON(): SerializedConversationReferenceNode {
    return {
      ...super.exportJSON(),
      type: "conversation-reference",
      featureId: this.__featureId,
      label: this.__label,
    };
  }

  getTextContent(): string {
    return serializeConversationReference({ featureId: this.__featureId, label: this.__label });
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

export function $createConversationReferenceNode(
  featureId: number,
  label: string,
): ConversationReferenceNode {
  const node = new ConversationReferenceNode(featureId, label);
  node.setMode("token");
  return node;
}
