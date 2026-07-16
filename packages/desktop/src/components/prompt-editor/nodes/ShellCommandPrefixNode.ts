import {
  TextNode,
  type DOMConversionMap,
  type DOMExportOutput,
  type EditorConfig,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";

type SerializedShellCommandPrefixNode = Spread<Record<never, never>, SerializedTextNode>;

/**
 * Serialized `!` prefix for Cadencr shell-command mode.
 *
 * The node remains part of editor text so drafts, history, and prompt sends
 * keep the exact backend syntax, while its zero-width DOM lets the user focus
 * on the command itself. The prompt bar renders the visible, removable mode
 * marker outside the contenteditable.
 */
export class ShellCommandPrefixNode extends TextNode {
  static getType(): string {
    return "shell-command-prefix";
  }

  static clone(node: ShellCommandPrefixNode): ShellCommandPrefixNode {
    return new ShellCommandPrefixNode(node.__key);
  }

  constructor(key?: NodeKey) {
    super("!", key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    // `h-0` + `align-top` keep this zero-width serialized `!` from inflating the
    // paragraph's line box — an `inline-block` with height would push the visible
    // command a few px below the leading prompt caret and break their alignment.
    element.className =
      "inline-block h-0 w-0 overflow-hidden align-top text-transparent select-none";
    element.dataset.shellCommandPrefix = "true";
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.textContent = "!";
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  static importJSON(): ShellCommandPrefixNode {
    return $createShellCommandPrefixNode();
  }

  exportJSON(): SerializedShellCommandPrefixNode {
    return {
      ...super.exportJSON(),
      type: "shell-command-prefix",
    };
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

export function $createShellCommandPrefixNode(): ShellCommandPrefixNode {
  const node = new ShellCommandPrefixNode();
  node.setMode("token");
  return node;
}

export function $isShellCommandPrefixNode(node: unknown): node is ShellCommandPrefixNode {
  return node instanceof ShellCommandPrefixNode;
}
