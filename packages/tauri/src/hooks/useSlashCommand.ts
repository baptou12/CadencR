import { useState, useMemo, useCallback } from "react";

export interface SlashCommand {
  [key: string]: unknown;
  name: string;
  description: string;
  argumentHint?: string;
}

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

export function useSlashCommand(commands: SlashCommand[] | undefined) {
  const [state, setState] = useState<SlashCommandState>(INITIAL_STATE);

  const filteredItems = useMemo(() => {
    if (!state.isOpen || !commands || commands.length === 0) return [];
    const q = state.query.toLowerCase();
    if (!q) return commands.slice(0, MAX_RESULTS);
    return commands
      .filter(
        (cmd) => cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q),
      )
      .slice(0, MAX_RESULTS);
  }, [state.isOpen, state.query, commands]);

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleChange = useCallback(
    (newText: string, selectionStart: number) => {
      // Slash commands only trigger at position 0
      if (!newText.startsWith("/")) {
        if (state.isOpen) close();
        return;
      }

      // Only trigger when cursor is within the slash command portion (before any space)
      const spaceIndex = newText.indexOf(" ");
      if (spaceIndex !== -1 && selectionStart > spaceIndex) {
        if (state.isOpen) close();
        return;
      }

      const query = newText.slice(1, spaceIndex === -1 ? selectionStart : spaceIndex);

      setState({
        isOpen: true,
        query,
        selectedIndex: 0,
      });
    },
    [state.isOpen, close],
  );

  const confirm = useCallback(
    (text: string, commandName?: string): { newText: string; newCursorPos: number } | null => {
      if (!state.isOpen || filteredItems.length === 0) return null;
      const item = commandName
        ? filteredItems.find((c) => c.name === commandName)
        : filteredItems[state.selectedIndex];
      if (!item) return null;

      const newText = `/${item.name} `;
      const newCursorPos = newText.length;

      close();
      return { newText, newCursorPos };
    },
    [state, filteredItems, close],
  );

  const handleKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      text: string,
    ): { newText: string; newCursorPos: number } | true | false => {
      if (!state.isOpen || filteredItems.length === 0) return false;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setState((s) => ({
          ...s,
          selectedIndex: (s.selectedIndex + 1) % filteredItems.length,
        }));
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
        const result = confirm(text);
        if (result) return result;
        return true;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }

      return false;
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
