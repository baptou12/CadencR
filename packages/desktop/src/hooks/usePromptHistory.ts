/**
 * Hook for per-project prompt history navigation (Up/Down arrow keys).
 * History is shared across all agents in a project and persisted to SQLite via WebSocket.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { createHistoryGet, createHistoryAdd } from "@/lib/ws-envelope";

interface HistoryResultPayload {
  entries: string[];
}

export function usePromptHistory(projectId: number, wsSessionId?: string) {
  const sendRequest = useWsSessionStore((s) => s.sendRequest);
  const isConnected = useWsSessionStore((s) =>
    wsSessionId ? (s.sessions[wsSessionId]?.isConnected ?? false) : false,
  );

  const [history, setHistory] = useState<string[]>([]);
  const historyRef = useRef<string[]>([]);
  historyRef.current = history;

  // -1 means "not browsing history"
  const [historyIndex, setHistoryIndex] = useState(-1);
  // Saves current input text when user starts browsing
  const [tempDraft, setTempDraft] = useState("");
  const tempDraftRef = useRef(tempDraft);
  tempDraftRef.current = tempDraft;
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;

  // Fetch history when WS connects
  useEffect(() => {
    if (!wsSessionId || !projectId || !isConnected) return;
    void sendRequest(wsSessionId, createHistoryGet(projectId)).then((payload) => {
      const data = payload as HistoryResultPayload;
      setHistory(data.entries ?? []);
    });
  }, [wsSessionId, projectId, isConnected, sendRequest]);

  /**
   * Called when Up arrow pressed on first line.
   * Returns new text to display, or null if already at oldest entry.
   */
  const navigateUp = useCallback((currentText: string): string | null => {
    const h = historyRef.current;
    const idx = historyIndexRef.current;
    if (h.length === 0) return null;
    if (idx === -1) {
      setTempDraft(currentText);
      setHistoryIndex(0);
      return h[0] ?? null;
    }
    if (idx < h.length - 1) {
      const next = idx + 1;
      setHistoryIndex(next);
      return h[next] ?? null;
    }
    return null;
  }, []);

  /**
   * Called when Down arrow pressed while browsing.
   * Returns new text to display, or null if not browsing.
   */
  const navigateDown = useCallback((): string | null => {
    const h = historyRef.current;
    const idx = historyIndexRef.current;
    if (idx === -1) return null;
    if (idx > 0) {
      const prev = idx - 1;
      setHistoryIndex(prev);
      return h[prev] ?? null;
    }
    // Back to current draft
    setHistoryIndex(-1);
    return tempDraftRef.current;
  }, []);

  const addEntry = useCallback(
    (content: string) => {
      if (!content.trim() || !wsSessionId || !projectId) return;
      const trimmed = content.trim();
      void sendRequest(wsSessionId, createHistoryAdd(projectId, trimmed)).then((payload) => {
        const data = payload as { added: boolean } | null;
        if (data?.added) {
          setHistory((prev) => [trimmed, ...prev].slice(0, 100));
        }
      });
      setHistoryIndex(-1);
      setTempDraft("");
    },
    [wsSessionId, projectId, sendRequest],
  );

  /**
   * Resets navigation state when user types, breaking out of history browse.
   */
  const resetNavigation = useCallback(() => {
    if (historyIndexRef.current !== -1) {
      setHistoryIndex(-1);
      setTempDraft("");
    }
  }, []);

  return useMemo(
    () => ({
      navigateUp,
      navigateDown,
      addEntry,
      resetNavigation,
      historyIndex,
    }),
    [navigateUp, navigateDown, addEntry, resetNavigation, historyIndex],
  );
}
