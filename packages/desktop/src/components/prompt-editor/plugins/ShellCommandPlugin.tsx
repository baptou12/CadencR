import { useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  TextNode,
} from "lexical";
import { getEditorText } from "../editor-utils";
import {
  $createShellCommandPrefixNode,
  $isShellCommandPrefixNode,
} from "../nodes/ShellCommandPrefixNode";

export interface ShellCommandEditorState {
  active: boolean;
  empty: boolean;
}

interface ShellCommandPluginProps {
  enabled: boolean;
  onStateChange: (state: ShellCommandEditorState) => void;
}

function transformLeadingBang(node: TextNode): void {
  if ($isShellCommandPrefixNode(node)) return;
  const firstParagraph = $getRoot().getFirstChild();
  if (!$isElementNode(firstParagraph)) return;
  if (firstParagraph?.getFirstChild() !== node) return;
  const text = node.getTextContent();
  if (!text.startsWith("!")) return;
  // Keep a bare `!` as ordinary text so Lexical has an editable caret target.
  // The editor hides it visually until the first command character is typed.
  if (text.length === 1) return;

  const selection = $getSelection();
  const nodeKey = node.getKey();
  const prefix = $createShellCommandPrefixNode();
  node.setTextContent(text.slice(1));
  node.insertBefore(prefix);
  if ($isRangeSelection(selection)) {
    if (selection.anchor.key === nodeKey)
      selection.anchor.set(nodeKey, Math.max(0, selection.anchor.offset - 1), "text");
    if (selection.focus.key === nodeKey)
      selection.focus.set(nodeKey, Math.max(0, selection.focus.offset - 1), "text");
  }
}

function restoreLeadingBang(): void {
  const firstParagraph = $getRoot().getFirstChild();
  const firstNode = $isElementNode(firstParagraph) ? firstParagraph.getFirstChild() : null;
  if (!$isShellCommandPrefixNode(firstNode)) return;
  firstNode.insertBefore($createTextNode("!"));
  firstNode.remove();
}

/** Converts only the prompt's first `!` into a hidden serialized prefix. */
export function ShellCommandPlugin({ enabled, onStateChange }: ShellCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const previousStateRef = useRef<ShellCommandEditorState>({ active: false, empty: false });

  useEffect(() => {
    if (enabled) return editor.registerNodeTransform(TextNode, transformLeadingBang);
    editor.update(restoreLeadingBang);
    return undefined;
  }, [editor, enabled]);

  useEffect(() => {
    const publishState = (active: boolean, empty: boolean): void => {
      const previous = previousStateRef.current;
      if (previous.active === active && previous.empty === empty) return;
      const next = { active, empty };
      previousStateRef.current = next;
      onStateChange(next);
    };
    const readAndPublish = (): void => {
      if (!enabled) {
        publishState(false, false);
        return;
      }
      const firstParagraph = $getRoot().getFirstChild();
      const firstNode = $isElementNode(firstParagraph) ? firstParagraph.getFirstChild() : null;
      const text = getEditorText();
      const active = $isShellCommandPrefixNode(firstNode) || text.startsWith("!");
      publishState(active, active && text === "!");
    };
    editor.getEditorState().read(readAndPublish);
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      editorState.read(readAndPublish);
    });
  }, [editor, enabled, onStateChange]);

  return null;
}
