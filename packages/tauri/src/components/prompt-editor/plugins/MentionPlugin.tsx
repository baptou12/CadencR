import { useCallback, useEffect, useRef, useState } from "react";
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
import { $createMentionNode } from "../nodes/MentionNode";
import { FileMentionPopover } from "@/components/FileMentionPopover";
import { useFileMention } from "@/hooks/useFileMention";

interface MentionPluginProps {
  files: string[] | undefined;
}

/**
 * Finds the `@query` trigger text before the cursor in the current selection.
 * Returns the query string and the offset of `@` in the text node, or null.
 */
function getTriggerMatch(
  anchorNode: TextNode,
  anchorOffset: number,
): { query: string; triggerOffset: number } | null {
  const text = anchorNode.getTextContent().slice(0, anchorOffset);
  const atIndex = text.lastIndexOf("@");
  if (atIndex === -1) return null;

  // @ must be at start or preceded by whitespace
  if (atIndex > 0 && !/\s/.test(text[atIndex - 1])) return null;

  const query = text.slice(atIndex + 1);
  // Close if query contains a space
  if (query.includes(" ")) return null;

  return { query, triggerOffset: atIndex };
}

export function MentionPlugin({ files }: MentionPluginProps) {
  const [editor] = useLexicalComposerContext();
  const mention = useFileMention(files);
  const mentionRef = useRef(mention);
  mentionRef.current = mention;
  const [cursorRect, setCursorRect] = useState<DOMRect | null>(null);

  // Sync editor text changes into the useFileMention hook
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const m = mentionRef.current;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          if (m.isOpen) m.close();
          return;
        }

        const anchor = selection.anchor;
        const node = anchor.getNode();
        if (!$isTextNode(node)) {
          if (m.isOpen) m.close();
          return;
        }

        const match = getTriggerMatch(node, anchor.offset);
        if (!match) {
          if (m.isOpen) m.close();
          return;
        }

        // Build a fake "full text" + cursor position for the hook
        const fullText = node.getTextContent();
        const cursorPos = anchor.offset;
        m.handleChange(fullText, cursorPos);

        // Get cursor position for popover
        updateCursorRect();
      });
    });
  }, [editor]);

  const updateCursorRect = useCallback(() => {
    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;
    const range = domSelection.getRangeAt(0);
    setCursorRect(range.getBoundingClientRect());
  }, []);

  // Insert a MentionNode replacing the @query text
  const handleSelect = useCallback(
    (path: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        const anchor = selection.anchor;
        const node = anchor.getNode();
        if (!$isTextNode(node)) return;

        const match = getTriggerMatch(node, anchor.offset);
        if (!match) return;

        // Split the text node to isolate the @query portion, then replace
        const triggerEnd = match.triggerOffset + 1 + match.query.length;
        const mentionNode = $createMentionNode(path);

        // Use splitText to isolate the mention range
        const splitPoints = [match.triggerOffset, triggerEnd].filter(
          (p) => p > 0 && p < node.getTextContentSize(),
        );
        const parts = node.splitText(...splitPoints);

        // Find the part containing the @ trigger
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

        const target = parts[targetIndex];
        target.replace(mentionNode);

        // Move cursor after the mention node
        mentionNode.selectNext(0, 0);
      });

      mention.close();
    },
    [editor, mention],
  );

  // Intercept keyboard events when the popover is open
  useEffect(() => {
    if (!mention.isOpen) return;

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
          mentionRef.current.handleKeyDown(fakeEvent("ArrowDown"), "");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        (e) => {
          e?.preventDefault();
          mentionRef.current.handleKeyDown(fakeEvent("ArrowUp"), "");
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (e) => {
          e?.preventDefault();
          const m = mentionRef.current;
          if (m.filteredItems.length > 0) {
            handleSelect(m.filteredItems[m.selectedIndex].path);
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (e) => {
          e?.preventDefault();
          const m = mentionRef.current;
          if (m.filteredItems.length > 0) {
            handleSelect(m.filteredItems[m.selectedIndex].path);
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (e) => {
          e?.preventDefault();
          mentionRef.current.close();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ];

    return () => commands.forEach((unregister) => unregister());
  }, [editor, mention.isOpen, handleSelect]);

  // Render popover positioned at cursor
  if (!mention.isOpen || mention.filteredItems.length === 0 || !cursorRect) {
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
      <FileMentionPopover
        open={true}
        items={mention.filteredItems}
        selectedIndex={mention.selectedIndex}
        onSelect={handleSelect}
        onClose={mention.close}
      >
        {/* Anchor element — empty since we position absolutely */}
        <span />
      </FileMentionPopover>
    </div>
  );
}
