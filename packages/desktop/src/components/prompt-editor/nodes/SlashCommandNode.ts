import {
  TextNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";

type SerializedSlashCommandNode = Spread<
  { commandName: string; prefix?: string },
  SerializedTextNode
>;

export class SlashCommandNode extends TextNode {
  __commandName: string;
  __prefix: string;

  static getType(): string {
    return "slash-command";
  }

  static clone(node: SlashCommandNode): SlashCommandNode {
    return new SlashCommandNode(node.__commandName, node.__prefix, node.__text, node.__key);
  }

  constructor(commandName: string, prefix = "/", text?: string, key?: NodeKey) {
    super(text ?? `${prefix}${commandName}`, key);
    this.__commandName = commandName;
    this.__prefix = prefix;
  }

  getCommandName(): string {
    return this.__commandName;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const el = super.createDOM(config);
    el.className =
      "inline-block rounded border border-[var(--chip-violet-fg)]/25 bg-[var(--chip-violet-bg)]/18 px-1 text-sm font-semibold text-[var(--chip-violet-fg)]";
    el.dataset.commandName = this.__commandName;
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = this.getTextContent();
    element.dataset.commandName = this.__commandName;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  static importJSON(serializedNode: SerializedSlashCommandNode): SlashCommandNode {
    return $createSlashCommandNode(serializedNode.commandName, serializedNode.prefix ?? "/");
  }

  exportJSON(): SerializedSlashCommandNode {
    return {
      ...super.exportJSON(),
      type: "slash-command",
      commandName: this.__commandName,
      prefix: this.__prefix,
    };
  }

  getTextContent(): string {
    return `${this.__prefix}${this.__commandName}`;
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

export function $createSlashCommandNode(commandName: string, prefix = "/"): SlashCommandNode {
  const node = new SlashCommandNode(commandName, prefix);
  node.setMode("token");
  return node;
}
