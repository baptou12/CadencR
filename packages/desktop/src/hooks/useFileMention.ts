import {
  useState,
  useMemo,
  useCallback,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useFileSearch } from "@/api/generated";

interface FileMentionState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  triggerIndex: number;
}

const INITIAL_STATE: FileMentionState = {
  isOpen: false,
  query: "",
  selectedIndex: 0,
  triggerIndex: -1,
};

const DEBOUNCE_MS = 150;

interface UseFileMentionParams {
  projectId: number | undefined;
  featureId: number | undefined;
}

interface MentionItem {
  path: string;
  isDir: boolean;
}

function useMentionChangeHandler(
  isOpen: boolean,
  close: () => void,
  setState: Dispatch<SetStateAction<FileMentionState>>,
): (newText: string, selectionStart: number) => void {
  return useCallback(
    (newText: string, selectionStart: number) => {
      const textBeforeCursor = newText.slice(0, selectionStart);
      const atIndex = textBeforeCursor.lastIndexOf("@");
      if (atIndex === -1 || (atIndex > 0 && !/\s/.test(newText[atIndex - 1]))) {
        if (isOpen) close();
        return;
      }

      const query = textBeforeCursor.slice(atIndex + 1);
      if (query.includes(" ")) {
        if (isOpen) close();
        return;
      }

      setState({ isOpen: true, query, selectedIndex: 0, triggerIndex: atIndex });
    },
    [close, isOpen, setState],
  );
}

type MentionKeyResult = { newText: string; newCursorPos: number } | true | false;

function useMentionKeyboard(
  isOpen: boolean,
  filteredItems: MentionItem[],
  confirm: (text: string) => Exclude<MentionKeyResult, boolean> | null,
  close: () => void,
  setState: Dispatch<SetStateAction<FileMentionState>>,
): (event: KeyboardEvent<HTMLTextAreaElement>, text: string) => MentionKeyResult {
  return useCallback(
    (event, text) => {
      if (!isOpen || filteredItems.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setState((current) => ({
          ...current,
          selectedIndex:
            (current.selectedIndex + delta + filteredItems.length) % filteredItems.length,
        }));
        return true;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        return confirm(text) ?? true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [close, confirm, filteredItems, isOpen, setState],
  );
}

export function useFileMention({ projectId, featureId }: UseFileMentionParams) {
  const [state, setState] = useState<FileMentionState>(INITIAL_STATE);

  // Source of truth is the backend fuzzy search (same as the file picker), so
  // freshly created files are always reachable — no stale client-side list.
  // We only query while the mention popover is open.
  const debouncedQuery = useDebouncedValue(state.query, DEBOUNCE_MS);
  const { data } = useFileSearch(
    {
      project_id: projectId ?? 0,
      feature_id: featureId,
      query: debouncedQuery || undefined,
      include_dirs: true,
    },
    {
      query: {
        enabled: state.isOpen && projectId != null,
        placeholderData: keepPreviousData,
      },
    },
  );

  const filteredItems = useMemo<MentionItem[]>(() => {
    if (!state.isOpen) return [];
    // Directories carry a trailing slash so the inserted mention reads as a
    // folder (e.g. `@src/components/`).
    return (data?.files ?? []).map((f) => ({
      path: f.is_dir ? `${f.path}/` : f.path,
      isDir: f.is_dir,
    }));
  }, [state.isOpen, data]);

  const close = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleChange = useMentionChangeHandler(state.isOpen, close, setState);

  const confirm = useCallback(
    (text: string, selectedPath?: string): { newText: string; newCursorPos: number } | null => {
      if (!state.isOpen || filteredItems.length === 0) return null;
      const item = selectedPath
        ? filteredItems.find((i) => i.path === selectedPath)
        : filteredItems[state.selectedIndex];
      if (!item) return null;

      const before = text.slice(0, state.triggerIndex);
      const after = text.slice(state.triggerIndex + 1 + state.query.length);
      const insertion = `@${item.path}`;
      const newText = before + insertion + (after.startsWith(" ") ? after : " " + after);
      const newCursorPos = before.length + insertion.length + 1;

      close();
      return { newText, newCursorPos };
    },
    [state, filteredItems, close],
  );

  const handleKeyDown = useMentionKeyboard(state.isOpen, filteredItems, confirm, close, setState);

  return useMemo(
    () => ({
      isOpen: state.isOpen,
      query: state.query,
      selectedIndex: state.selectedIndex,
      filteredItems,
      handleChange,
      handleKeyDown,
      confirm,
      close,
    }),
    [close, confirm, filteredItems, handleChange, handleKeyDown, state],
  );
}
