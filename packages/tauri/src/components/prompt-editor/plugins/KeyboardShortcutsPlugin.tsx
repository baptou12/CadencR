import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  type LexicalCommand,
} from "lexical";
import { setEditorText } from "../editor-utils";

interface KeyboardShortcutsPluginProps {
  onEnterSend?: () => boolean;
  onArrowUp?: () => string | null;
  onArrowDown?: () => string | null;
}

function hasDomSiblingInDirection(
  rootElement: HTMLElement,
  node: Node,
  direction: "previous" | "next",
): boolean {
  let current: Node | null = node;

  while (current && current !== rootElement) {
    const sibling =
      direction === "previous"
        ? current.previousSibling
        : current.nextSibling;
    if (sibling) return true;
    current = current.parentNode;
  }

  return false;
}

function isCursorAtDocumentBoundary(
  editor: ReturnType<typeof useLexicalComposerContext>[0],
  boundary: "start" | "end",
): boolean {
  const rootElement = editor.getRootElement();
  if (!rootElement) return false;

  const selection = rootElement.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  const anchorNode = selection.anchorNode;
  if (!anchorNode || !rootElement.contains(anchorNode)) return false;

  if (anchorNode.nodeType === Node.TEXT_NODE) {
    const textLength = anchorNode.textContent?.length ?? 0;
    if (boundary === "start" && selection.anchorOffset > 0) return false;
    if (boundary === "end" && selection.anchorOffset < textLength) return false;
  } else {
    const childCount = anchorNode.childNodes.length;
    if (boundary === "start" && selection.anchorOffset > 0) return false;
    if (boundary === "end" && selection.anchorOffset < childCount) return false;
  }

  return !hasDomSiblingInDirection(
    rootElement,
    anchorNode,
    boundary === "start" ? "previous" : "next",
  );
}

/**
 * Handles Enter-to-send and arrow key prompt history at COMMAND_PRIORITY_NORMAL.
 * Popover plugins (mention, slash) register at COMMAND_PRIORITY_HIGH and will
 * intercept first when their popovers are open.
 */
export function KeyboardShortcutsPlugin({
  onEnterSend,
  onArrowUp,
  onArrowDown,
}: KeyboardShortcutsPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event?.shiftKey) return false;
        if (!onEnterSend) return false;
        event?.preventDefault();
        return onEnterSend();
      },
      COMMAND_PRIORITY_NORMAL,
    );

    function registerArrowHandler(
      command: LexicalCommand<KeyboardEvent | null>,
      callback: (() => string | null) | undefined,
      boundary: "start" | "end",
    ) {
      return editor.registerCommand(
        command,
        (event) => {
          if (!callback || event?.metaKey || event?.altKey) return false;
          if (!isCursorAtDocumentBoundary(editor, boundary)) return false;
          const result = callback();
          event?.preventDefault();
          if (result === null) return true;
          setEditorText(editor, result);
          return true;
        },
        COMMAND_PRIORITY_NORMAL,
      );
    }

    const unregisterUp = registerArrowHandler(KEY_ARROW_UP_COMMAND, onArrowUp, "start");
    const unregisterDown = registerArrowHandler(KEY_ARROW_DOWN_COMMAND, onArrowDown, "end");

    return () => {
      unregisterEnter();
      unregisterUp();
      unregisterDown();
    };
  }, [editor, onEnterSend, onArrowUp, onArrowDown]);

  return null;
}
