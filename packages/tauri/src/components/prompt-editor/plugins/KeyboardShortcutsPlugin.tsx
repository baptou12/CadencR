import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_NORMAL,
  KEY_ENTER_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
} from "lexical";

interface KeyboardShortcutsPluginProps {
  /** Called when Enter is pressed (no shift). Return true to prevent default. */
  onEnterSend?: () => boolean;
  /** Called on ArrowUp when editor is empty. Returns text to set, or null. */
  onArrowUp?: () => string | null;
  /** Called on ArrowDown for history navigation. Returns text to set, or null. */
  onArrowDown?: () => string | null;
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
        if (event?.shiftKey) return false; // Let Lexical insert newline
        if (!onEnterSend) return false;
        event?.preventDefault();
        return onEnterSend();
      },
      COMMAND_PRIORITY_NORMAL,
    );

    const unregisterUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!onArrowUp || event?.metaKey || event?.altKey) return false;
        // Only handle when editor is empty
        let isEmpty = false;
        editor.getEditorState().read(() => {
          isEmpty = $getRoot().getTextContent().trim() === "";
        });
        if (!isEmpty) return false;

        const result = onArrowUp();
        if (result === null) return false;
        event?.preventDefault();
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode(result));
          root.append(p);
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );

    const unregisterDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (!onArrowDown || event?.metaKey || event?.altKey) return false;
        const result = onArrowDown();
        if (result === null) return false;
        event?.preventDefault();
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          const p = $createParagraphNode();
          p.append($createTextNode(result));
          root.append(p);
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );

    return () => {
      unregisterEnter();
      unregisterUp();
      unregisterDown();
    };
  }, [editor, onEnterSend, onArrowUp, onArrowDown]);

  return null;
}
