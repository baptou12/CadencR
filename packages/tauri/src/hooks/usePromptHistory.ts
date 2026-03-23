/**
 * Hook for per-project prompt history navigation (Up/Down arrow keys).
 * History is shared across all agents in a project and persisted to SQLite.
 */

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspacePromptHistory,
  useAddWorkspacePromptEntry,
  getGetWorkspacePromptHistoryQueryKey,
} from "../api/generated";

export function usePromptHistory(projectId: number) {
  const queryClient = useQueryClient();
  const historyQuery = useGetWorkspacePromptHistory(projectId);
  const addEntryMutation = useAddWorkspacePromptEntry();

  // Use a ref so callbacks don't recreate when data changes
  const historyRef = useRef<string[]>([]);
  historyRef.current = historyQuery.data ?? [];

  // -1 means "not browsing history"
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Saves current input text when user starts browsing
  const [tempDraft, setTempDraft] = useState("");
  const tempDraftRef = useRef(tempDraft);
  tempDraftRef.current = tempDraft;
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;

  /**
   * Called when Up arrow pressed with empty input.
   * Returns new text to display, or null if already at oldest entry.
   */
  const navigateUp = useCallback(
    (currentText: string): string | null => {
      const history = historyRef.current;
      const idx = historyIndexRef.current;
      if (history.length === 0) return null;
      if (idx === -1) {
        // Start browsing — save current text
        setTempDraft(currentText);
        setHistoryIndex(0);
        return history[0] ?? null;
      }
      if (idx < history.length - 1) {
        const next = idx + 1;
        setHistoryIndex(next);
        return history[next] ?? null;
      }
      // Already at oldest entry
      return null;
    },
    [],
  );

  /**
   * Called when Down arrow pressed while browsing.
   * Returns new text to display, or null if not browsing.
   */
  const navigateDown = useCallback((): string | null => {
    const history = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx === -1) return null;
    if (idx > 0) {
      const prev = idx - 1;
      setHistoryIndex(prev);
      return history[prev] ?? null;
    }
    // Back to current draft
    setHistoryIndex(-1);
    return tempDraftRef.current;
  }, []);

  /**
   * Adds a new entry to history, invalidates the cache, resets navigation.
   */
  const addEntry = useCallback(
    (content: string) => {
      if (!content.trim()) return;
      addEntryMutation.mutate(
        { projectId, content },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({
              queryKey: getGetWorkspacePromptHistoryQueryKey(projectId),
            });
          },
        },
      );
      setHistoryIndex(-1);
      setTempDraft("");
    },
    [projectId, addEntryMutation, queryClient],
  );

  /**
   * Resets navigation state when user types, breaking out of history browse.
   */
  const resetNavigation = useCallback(() => {
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      setTempDraft("");
    }
  }, [historyIndex]);

  return {
    navigateUp,
    navigateDown,
    addEntry,
    resetNavigation,
    historyIndex,
  };
}
