import {
  useState,
  useMemo,
  useCallback,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import type { SlashCommand } from "@/lib/slash-command";

export type { SlashCommand, SlashCommandKind } from "@/lib/slash-command";

interface SlashCommandState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
}

const INITIAL_STATE: SlashCommandState = {
  isOpen: false,
  query: "",
  selectedIndex: 0,
};

const MAX_RESULTS = 20;
type SlashCommandKeyDownResult = { newText: string; newCursorPos: number } | true | false;

function commandMatchRank(command: SlashCommand, query: string): number | null {
  const name = command.name.toLowerCase();
  const description = command.description.toLowerCase();
  const namespaceName = name.split(":").at(-1) ?? name;

  if (name === query || namespaceName === query) return 0;
  if (name.startsWith(query)) return 1;
  if (namespaceName.startsWith(query)) return 2;
  if (name.includes(query)) return 3;
  if (description.includes(query)) return 4;
  return null;
}

interface OpenKeyDownArgs {
  e: KeyboardEvent<HTMLTextAreaElement>;
  filteredItems: SlashCommand[];
  setState: Dispatch<SetStateAction<SlashCommandState>>;
  confirm: (text: string) => { newText: string; newCursorPos: number } | null;
  close: () => void;
  text: string;
}

function handleOpenKeyDown({
  e,
  filteredItems,
  setState,
  confirm,
  close,
  text,
}: OpenKeyDownArgs): SlashCommandKeyDownResult {
  if (filteredItems.length === 0) return false;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    setState((s) => ({ ...s, selectedIndex: (s.selectedIndex + 1) % filteredItems.length }));
    return true;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    setState((s) => ({
      ...s,
      selectedIndex: (s.selectedIndex - 1 + filteredItems.length) % filteredItems.length,
    }));
    return true;
  }

  if (e.key === "Tab" || e.key === "Enter") {
    e.preventDefault();
    return confirm(text) ?? true;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    close();
    return true;
  }

  return false;
}

export function useSlashCommand(commands: SlashCommand[] | undefined, triggerChar = "/") {
  const [state, setState] = useState<SlashCommandState>(INITIAL_STATE);

  const filteredItems = useMemo(() => {
    if (!state.isOpen || !commands || commands.length === 0) return [];
    const q = state.query.toLowerCase();
    if (!q) return commands.slice(0, MAX_RESULTS);
    return commands
      .map((cmd, index) => ({ cmd, index, rank: commandMatchRank(cmd, q) }))
      .filter(
        (item): item is { cmd: SlashCommand; index: number; rank: number } => item.rank != null,
      )
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((item) => item.cmd)
      .slice(0, MAX_RESULTS);
  }, [state.isOpen, state.query, commands]);

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleChange = useCallback(
    (newText: string, selectionStart: number) => {
      if (!newText.startsWith(triggerChar)) {
        if (state.isOpen) close();
        return;
      }

      // Only trigger when cursor is within the slash command portion (before any space)
      const spaceIndex = newText.indexOf(" ");
      if (spaceIndex !== -1 && selectionStart > spaceIndex) {
        if (state.isOpen) close();
        return;
      }

      const query = newText.slice(
        triggerChar.length,
        spaceIndex === -1 ? selectionStart : spaceIndex,
      );

      setState({
        isOpen: true,
        query,
        selectedIndex: 0,
      });
    },
    [state.isOpen, close, triggerChar],
  );

  const confirm = useCallback(
    (text: string, commandName?: string): { newText: string; newCursorPos: number } | null => {
      if (!state.isOpen || filteredItems.length === 0) return null;
      const item = commandName
        ? filteredItems.find((c) => c.name === commandName)
        : filteredItems[state.selectedIndex];
      if (!item) return null;

      const newText = `${triggerChar}${item.name} `;
      const newCursorPos = newText.length;

      close();
      return { newText, newCursorPos };
    },
    [state, filteredItems, close, triggerChar],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>, text: string): SlashCommandKeyDownResult => {
      if (!state.isOpen) return false;
      return handleOpenKeyDown({ e, filteredItems, setState, confirm, close, text });
    },
    [state.isOpen, filteredItems, confirm, close],
  );

  return {
    isOpen: state.isOpen,
    query: state.query,
    selectedIndex: state.selectedIndex,
    filteredItems,
    handleChange,
    handleKeyDown,
    confirm,
    close,
  };
}
