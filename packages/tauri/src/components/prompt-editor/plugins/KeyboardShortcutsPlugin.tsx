import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalCommand,
} from "lexical";
import { setEditorText } from "../editor-utils";

interface KeyboardShortcutsPluginProps {
  onEnterSend?: () => boolean;
  onArrowUp?: () => string | null;
  onArrowDown?: () => string | null;
}

/** Check if the cursor is on the edge paragraph (first or last child of root). */
function isCursorOnEdge(editor: ReturnType<typeof useLexicalComposerContext>[0], edge: "first" | "last"): boolean {
  let result = false;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const topElement = selection.anchor.getNode().getTopLevelElement();
    if (!topElement) return;
    const root = $getRoot();
    const edgeChild = edge === "first" ? root.getFirstChild() : root.getLastChild();
    result = edgeChild?.getKey() === topElement.getKey();
  });
  return result;
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
      edge: "first" | "last",
    ) {
      return editor.registerCommand(
        command,
        (event) => {
          if (!callback || event?.metaKey || event?.altKey) return false;
          if (!isCursorOnEdge(editor, edge)) return false;
          const result = callback();
          if (result === null) return false;
          event?.preventDefault();
          setEditorText(editor, result);
          return true;
        },
        COMMAND_PRIORITY_NORMAL,
      );
    }

    const unregisterUp = registerArrowHandler(KEY_ARROW_UP_COMMAND, onArrowUp, "first");
    const unregisterDown = registerArrowHandler(KEY_ARROW_DOWN_COMMAND, onArrowDown, "last");

    return () => {
      unregisterEnter();
      unregisterUp();
      unregisterDown();
    };
  }, [editor, onEnterSend, onArrowUp, onArrowDown]);

  return null;
}
