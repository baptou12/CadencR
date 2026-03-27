import { useCallback, useEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { $createSlashCommandNode } from "../nodes/SlashCommandNode";
import { SlashCommandPopover } from "@/components/SlashCommandPopover";
import { useSlashCommand, type SlashCommand } from "@/hooks/useSlashCommand";
import {
  getTriggerMatch,
  replaceTriggerWithNode,
  usePopoverKeyboardCommands,
  useCursorRect,
  CursorPopover,
} from "./trigger-utils";

interface SlashCommandPluginProps {
  commands: SlashCommand[] | undefined;
  isLoading?: boolean;
}

export function SlashCommandPlugin({ commands, isLoading }: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  const slash = useSlashCommand(commands);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const [cursorRect, updateCursorRect] = useCursorRect();

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const s = slashRef.current;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (s.isOpen) s.close();
          return;
        }

        const anchor = selection.anchor;
        const node = anchor.getNode();
        if (!$isTextNode(node)) {
          if (s.isOpen) s.close();
          return;
        }

        const match = getTriggerMatch(node, anchor.offset, "/");
        // Slash commands only trigger at the very start of the editor
        const isFirstNode =
          node.getPreviousSibling() === null &&
          node.getParent() === $getRoot().getFirstChild();
        if (!match || match.triggerOffset !== 0 || !isFirstNode) {
          if (s.isOpen) s.close();
          return;
        }

        const syntheticText = "/" + match.query;
        s.handleChange(syntheticText, syntheticText.length);
        updateCursorRect();
      });
    });
  }, [editor, updateCursorRect]);

  const handleSelect = useCallback(
    (commandName: string) => {
      replaceTriggerWithNode(editor, "/", $createSlashCommandNode, commandName, () =>
        slash.close(),
      );
    },
    [editor, slash],
  );

  const getSelectedValue = useCallback(() => {
    const s = slashRef.current;
    return s.filteredItems.length > 0 ? s.filteredItems[s.selectedIndex].name : undefined;
  }, []);

  usePopoverKeyboardCommands(editor, slash.isOpen, slashRef, getSelectedValue, handleSelect);

  if (!slash.isOpen || slash.filteredItems.length === 0 || !cursorRect) return null;

  return (
    <CursorPopover cursorRect={cursorRect}>
      <SlashCommandPopover
        open={true}
        items={slash.filteredItems}
        selectedIndex={slash.selectedIndex}
        onSelect={handleSelect}
        isLoading={isLoading ?? false}
      >
        <span />
      </SlashCommandPopover>
    </CursorPopover>
  );
}
