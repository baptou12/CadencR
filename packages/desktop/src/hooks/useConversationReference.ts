import { useCallback, useMemo, useState } from "react";
import {
  useListConversationReferences,
  type ConversationReferenceCandidate,
} from "@/api/generated";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface ConversationReferenceState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
}

const INITIAL_STATE: ConversationReferenceState = {
  isOpen: false,
  query: "",
  selectedIndex: 0,
};

export function useConversationReference(currentFeatureId: number | undefined, enabled: boolean) {
  const [state, setState] = useState(INITIAL_STATE);
  const debouncedQuery = useDebouncedValue(state.query, 150);
  const isDebouncing = state.query !== debouncedQuery;
  const result = useListConversationReferences(
    {
      current_feature_id: currentFeatureId ?? 0,
      query: debouncedQuery || undefined,
      limit: 20,
    },
    {
      query: {
        enabled: state.isOpen && currentFeatureId != null && enabled,
        keepPreviousData: true,
      },
    },
  );
  const filteredItems = useMemo(
    () => (state.isOpen && !isDebouncing ? (result.data ?? []) : []),
    [isDebouncing, result.data, state.isOpen],
  );

  const close = useCallback(() => setState(INITIAL_STATE), []);
  const updateQuery = useCallback((query: string) => {
    setState((current) =>
      current.isOpen && current.query === query
        ? current
        : { isOpen: true, query, selectedIndex: 0 },
    );
  }, []);
  const moveSelection = useCallback((delta: number, itemCount: number) => {
    if (itemCount === 0) return;
    setState((current) => ({
      ...current,
      selectedIndex: (current.selectedIndex + delta + itemCount) % itemCount,
    }));
  }, []);
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key === "ArrowDown") moveSelection(1, filteredItems.length);
      if (event.key === "ArrowUp") moveSelection(-1, filteredItems.length);
      if (event.key === "Escape") close();
    },
    [close, filteredItems.length, moveSelection],
  );

  return useMemo(
    () => ({
      isOpen: state.isOpen,
      query: state.query,
      selectedIndex: state.selectedIndex,
      filteredItems,
      isLoading: isDebouncing || result.isFetching,
      isError: result.isError,
      error: result.error,
      updateQuery,
      handleKeyDown,
      close,
    }),
    [
      close,
      filteredItems,
      handleKeyDown,
      isDebouncing,
      result.error,
      result.isError,
      result.isFetching,
      state.isOpen,
      state.query,
      state.selectedIndex,
      updateQuery,
    ],
  );
}

export type ConversationReferenceItem = ConversationReferenceCandidate;
