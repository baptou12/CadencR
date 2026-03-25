import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from "lexical";

/** Result of matching a trigger character (e.g. `@` or `/`) before the cursor. */
export interface TriggerMatch {
  query: string;
  triggerOffset: number;
}

/**
 * Finds `<triggerChar>query` text before the cursor in the given text node.
 * The trigger must be at the start of text or preceded by whitespace.
 * Returns null if no valid trigger is found.
 */
export function getTriggerMatch(
  anchorNode: TextNode,
  anchorOffset: number,
  triggerChar: string,
): TriggerMatch | null {
  const text = anchorNode.getTextContent().slice(0, anchorOffset);
  const idx = text.lastIndexOf(triggerChar);
  if (idx === -1) return null;
  if (idx > 0 && !/\s/.test(text[idx - 1])) return null;

  const query = text.slice(idx + 1);
  if (query.includes(" ")) return null;

  return { query, triggerOffset: idx };
}

/**
 * Replaces the trigger text (e.g. `@query` or `/query`) in the current selection
 * with a new Lexical node. Moves the cursor after the inserted node.
 */
export function replaceTriggerWithNode(
  editor: LexicalEditor,
  triggerChar: string,
  createNode: (value: string) => LexicalNode,
  value: string,
  onDone: () => void,
): void {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

    const anchor = selection.anchor;
    const node = anchor.getNode();
    if (!$isTextNode(node)) return;

    const match = getTriggerMatch(node, anchor.offset, triggerChar);
    if (!match) return;

    const triggerEnd = match.triggerOffset + 1 + match.query.length;
    const newNode = createNode(value);

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

    parts[targetIndex].replace(newNode);
    // Insert a trailing space so the cursor has a proper text position
    // after the token node (which has canInsertTextAfter() = false).
    const spaceNode = $createTextNode(" ");
    newNode.insertAfter(spaceNode);
    spaceNode.select();
  });

  onDone();
}

/** Hook state expected from the underlying trigger hook (useFileMention / useSlashCommand). */
interface TriggerHookState {
  isOpen: boolean;
  close: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>, text: string) => void;
  filteredItems: { [key: string]: unknown }[];
  selectedIndex: number;
}

/**
 * Registers the 5 keyboard commands (ArrowUp, ArrowDown, Enter, Tab, Escape)
 * on the editor while the popover is open.
 */
export function usePopoverKeyboardCommands(
  editor: LexicalEditor,
  isOpen: boolean,
  hookRef: RefObject<TriggerHookState>,
  getSelectedValue: () => string | undefined,
  onSelect: (value: string) => void,
): void {
  useEffect(() => {
    if (!isOpen) return;

    const fakeEvent = (key: string) =>
      ({
        key,
        preventDefault: () => {},
        shiftKey: false,
        metaKey: false,
        altKey: false,
      }) as React.KeyboardEvent<HTMLTextAreaElement>;

    const commands = [
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (e) => {
          e?.preventDefault();
          hookRef.current.handleKeyDown(fakeEvent("ArrowDown"), "");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (e) => {
          e?.preventDefault();
          hookRef.current.handleKeyDown(fakeEvent("ArrowUp"), "");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          const val = getSelectedValue();
          if (val === undefined) return false;
          e?.preventDefault();
          onSelect(val);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (e) => {
          const val = getSelectedValue();
          if (val === undefined) return false;
          e?.preventDefault();
          onSelect(val);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (e) => {
          e?.preventDefault();
          hookRef.current.close();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];

    return () => commands.forEach((unregister) => unregister());
  }, [editor, isOpen, hookRef, getSelectedValue, onSelect]);
}

/** Hook that tracks cursor position as a DOMRect for popover positioning. */
export function useCursorRect(): [DOMRect | null, () => void] {
  const [cursorRect, setCursorRect] = useState<DOMRect | null>(null);

  const updateCursorRect = useCallback(() => {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;
    const range = domSelection.getRangeAt(0);
    setCursorRect(range.getBoundingClientRect());
  }, []);

  return [cursorRect, updateCursorRect];
}

/** Wrapper component for positioning a popover above the cursor. */
export function CursorPopover({
  cursorRect,
  children,
}: {
  cursorRect: DOMRect;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed z-50"
      style={{
        left: cursorRect.left,
        top: cursorRect.top - 4,
        transform: "translateY(-100%)",
      }}
    >
      {children}
    </div>
  );
}
