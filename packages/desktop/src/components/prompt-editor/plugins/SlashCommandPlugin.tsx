import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { $createSlashCommandNode } from "../nodes/SlashCommandNode";
import { SlashCommandPopover } from "@/components/SlashCommandPopover";
import { useSlashCommand, type SlashCommand } from "@/hooks/useSlashCommand";
import { useProjectMcpEnabled, useWorkspaceMcpEnabled } from "@/lib/mcp-settings";
import {
  getTriggerMatch,
  replaceTriggerWithNode,
  usePopoverKeyboardCommands,
} from "./trigger-utils";

interface SlashCommandPluginProps {
  commands: SlashCommand[] | undefined;
  isLoading?: boolean;
  commandKind?: SlashCommand["kind"];
  triggerChar?: "/" | "$";
}

/** Minimal view of the `useSlashCommand` hook the editor sync callback needs. */
interface TriggerSync {
  isOpen: boolean;
  close: () => void;
  handleChange: (text: string, cursor: number) => void;
}

/** Re-derive the open/query state of the trigger popover from the current
 * editor selection. Read-only (runs inside `editorState.read`). */
function syncTriggerFromEditor(s: TriggerSync, triggerChar: "/" | "$"): void {
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
  const match = getTriggerMatch(node, anchor.offset, triggerChar);
  if (!match) {
    if (s.isOpen) s.close();
    return;
  }
  // Slash commands ("/") only open at the very start of the editor. Skills
  // ("$") can appear anywhere and multiple times, like @ mentions.
  if (triggerChar === "/") {
    const isAtStart =
      match.triggerOffset === 0 &&
      node.getPreviousSibling() === null &&
      node.getParent() === $getRoot().getFirstChild();
    if (!isAtStart) {
      if (s.isOpen) s.close();
      return;
    }
  }
  const syntheticText = triggerChar + match.query;
  s.handleChange(syntheticText, syntheticText.length);
}

export function SlashCommandPlugin({
  commands,
  isLoading,
  commandKind,
  triggerChar = "/",
}: SlashCommandPluginProps) {
  const [editor] = useLexicalComposerContext();
  // Cadencr virtual skills are provider-neutral and appear in BOTH the `/` and
  // `$` menus, so they're never filtered out by `commandKind`.
  const filteredCommands = useMemo(
    () =>
      commands?.filter(
        (command) => !commandKind || command.kind === commandKind || command.kind === "cadencr",
      ),
    [commands, commandKind],
  );
  // The `/cadencr:*` skills call both the project MCP (spawn/link/gates) and
  // the workspace MCP (session graph, project listing) tools, so both must be
  // on. When either is off the skills are shown but disabled (non-selectable)
  // rather than hidden.
  const { enabled: projectMcpEnabled } = useProjectMcpEnabled();
  const { enabled: workspaceMcpEnabled } = useWorkspaceMcpEnabled();
  const cadencrEnabled = projectMcpEnabled && workspaceMcpEnabled;
  const isDisabled = useCallback(
    (command: SlashCommand | undefined) => command?.kind === "cadencr" && !cadencrEnabled,
    [cadencrEnabled],
  );
  const slash = useSlashCommand(filteredCommands, triggerChar);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => syncTriggerFromEditor(slashRef.current, triggerChar));
    });
  }, [editor, triggerChar]);

  const handleSelect = useCallback(
    (commandName: string) => {
      const target = filteredCommands?.find((command) => command.name === commandName);
      if (isDisabled(target)) return; // disabled cadencr skill — ignore selection
      replaceTriggerWithNode(
        editor,
        triggerChar,
        (name) => $createSlashCommandNode(name, triggerChar),
        commandName,
        () => slashRef.current.close(),
      );
    },
    // `slashRef` is stable, so `onSelect` stays referentially stable and the
    // memoized `SlashCommandItem` rows don't re-render on every keystroke.
    [editor, triggerChar, filteredCommands, isDisabled],
  );

  const getSelectedValue = useCallback(() => {
    const s = slashRef.current;
    const item = s.filteredItems.length > 0 ? s.filteredItems[s.selectedIndex] : undefined;
    // Return undefined for a disabled skill so Enter/Tab fall through instead of
    // selecting it.
    return item && !isDisabled(item) ? item.name : undefined;
  }, [isDisabled]);

  usePopoverKeyboardCommands(editor, slash.isOpen, slashRef, getSelectedValue, handleSelect);

  if (!slash.isOpen || (!isLoading && slash.filteredItems.length === 0)) return null;

  return (
    <SlashCommandPopover
      open={true}
      items={slash.filteredItems}
      selectedIndex={slash.selectedIndex}
      onSelect={handleSelect}
      isLoading={isLoading ?? false}
      triggerChar={triggerChar}
      cadencrDisabled={!cadencrEnabled}
    >
      <span />
    </SlashCommandPopover>
  );
}
