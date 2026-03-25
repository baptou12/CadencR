import { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
} from "lexical";
import { $createSlashCommandNode } from "../nodes/SlashCommandNode";
import { SlashCommandPopover } from "@/components/SlashCommandPopover";
import { useSlashCommand, type SlashCommand } from "@/hooks/useSlashCommand";

interface SlashCommandPluginProps {
  commands: SlashCommand[] | undefined;
  isLoading?: boolean;
}

/**
 * Finds `/query` trigger text before the cursor.
 * Only matches `/` at start of text or after whitespace.
 */
function getTriggerMatch(
  anchorNode: TextNode,
  anchorOffset: number,
): { query: string; triggerOffset: number } | null {
  const text = anchorNode.getTextContent().slice(0, anchorOffset);
  const slashIndex = text.lastIndexOf("/");
  if (slashIndex === -1) return null;

  // `/` must be at start or preceded by whitespace
  if (slashIndex > 0 && !/\s/.test(text[slashIndex - 1])) return null;

  const query = text.slice(slashIndex + 1);
  // Close if query contains a space
  if (query.includes(" ")) return null;

  return { query, triggerOffset: slashIndex };
}

export function SlashCommandPlugin({ commands, isLoading }: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const slash = useSlashCommand(commands);
  const [cursorRect, setCursorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (slash.isOpen) slash.close();
          return;
        }

        const anchor = selection.anchor;
        const node = anchor.getNode();
        if (!$isTextNode(node)) {
          if (slash.isOpen) slash.close();
          return;
        }

        const match = getTriggerMatch(node, anchor.offset);
        if (!match) {
          if (slash.isOpen) slash.close();
          return;
        }

        // Feed the hook a synthetic text starting with `/` so it triggers
        const syntheticText = "/" + match.query;
        slash.handleChange(syntheticText, syntheticText.length);

        updateCursorRect();
      });
    });
  }, [editor, slash]);

  const updateCursorRect = useCallback(() => {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;
    const range = domSelection.getRangeAt(0);
    setCursorRect(range.getBoundingClientRect());
  }, []);

  const handleSelect = useCallback(
    (commandName: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        const anchor = selection.anchor;
        const node = anchor.getNode();
        if (!$isTextNode(node)) return;

        const match = getTriggerMatch(node, anchor.offset);
        if (!match) return;

        const triggerEnd = match.triggerOffset + 1 + match.query.length;
        const commandNode = $createSlashCommandNode(commandName);

        const splitPoints = [match.triggerOffset, triggerEnd].filter(
          (p) => p > 0 && p < node.getTextContentSize(),
        );
        const parts = node.splitText(...splitPoints);

        let targetIndex = 0;
        let offset = 0;
        for (let i = 0; i < parts.length; i++) {
          const len = parts[i].getTextContentSize();
          if (offset <= match.triggerOffset && match.triggerOffset < offset + len) {
            targetIndex = i;
            break;
          }
          offset += len;
        }

        parts[targetIndex].replace(commandNode);
        commandNode.selectNext(0, 0);
      });

      slash.close();
    },
    [editor, slash],
  );

  // Intercept keyboard events when popover is open
  useEffect(() => {
    if (!slash.isOpen) return;

    const commands = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (e) => {
          e?.preventDefault();
          slash.handleKeyDown(
            { key: "ArrowDown", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
            "",
          );
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (e) => {
          e?.preventDefault();
          slash.handleKeyDown(
            { key: "ArrowUp", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
            "",
          );
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          e?.preventDefault();
          if (slash.filteredItems.length > 0) {
            handleSelect(slash.filteredItems[slash.selectedIndex].name);
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (e) => {
          e?.preventDefault();
          if (slash.filteredItems.length > 0) {
            handleSelect(slash.filteredItems[slash.selectedIndex].name);
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (e) => {
          e?.preventDefault();
          slash.close();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];

    return () => commands.forEach((unregister) => unregister());
  }, [editor, slash, handleSelect]);

  if (!slash.isOpen || slash.filteredItems.length === 0 || !cursorRect) {
    return null;
  }

  return (
    <div
      className="fixed z-50"
      style={{
        left: cursorRect.left,
        top: cursorRect.top - 4,
        transform: "translateY(-100%)",
      }}
    >
      <SlashCommandPopover
        open={true}
        items={slash.filteredItems}
        selectedIndex={slash.selectedIndex}
        onSelect={handleSelect}
        isLoading={isLoading ?? false}
      >
        <span />
      </SlashCommandPopover>
    </div>
  );
}
