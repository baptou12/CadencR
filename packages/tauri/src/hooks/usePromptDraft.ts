/**
 * Hook for persisting per-agent-session draft prompt text.
 * Uses WebSocket when wsSessionId is provided, falls back to HTTP.
 * Fetches saved draft on mount to restore after navigation.
 * Debounces saves (500ms) and flushes on unmount.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useSaveSessionDraft, useGetSessionDraft } from "@/api/generated";
import { createDraftGet, createDraftSave } from "@/lib/ws-envelope";

interface UsePromptDraftOptions {
  /** DB session ID (for workflow agents that know it). */
  sessionId: number | undefined;
  /** WS store key — when provided, derives DB session ID from serverSessionId. */
  wsSessionId?: string | undefined;
  initialDraft: string | null;
}

interface DraftResultPayload {
  draft: string | null;
}

export function usePromptDraft({ sessionId, wsSessionId, initialDraft }: UsePromptDraftOptions) {
  const sendRaw = useWsSessionStore((s) => s.send);
  const sendRequest = useWsSessionStore((s) => s.sendRequest);
  const isConnected = useWsSessionStore((s) =>
    wsSessionId ? (s.sessions[wsSessionId]?.isConnected ?? false) : false,
  );
  const serverSessionId = useWsSessionStore((s) =>
    wsSessionId ? (s.sessions[wsSessionId]?.serverSessionId ?? "") : "",
  );
  const saveDraftMutation = useSaveSessionDraft();

  // Resolve the DB session ID: use serverSessionId from WS store, or fall back to prop
  const dbSessionId = useMemo(() => {
    if (wsSessionId && serverSessionId) {
      const parsed = parseInt(serverSessionId, 10);
      return isNaN(parsed) ? sessionId : parsed;
    }
    return sessionId;
  }, [wsSessionId, serverSessionId, sessionId]);

  // For HTTP-path agents, fetch the draft from DB on mount
  const httpDraftQuery = useGetSessionDraft(sessionId ?? 0, {
    enabled: !wsSessionId && !!sessionId,
  });

  const [restoredDraft, setRestoredDraft] = useState<string | null>(initialDraft);

  // Sync HTTP draft query result
  useEffect(() => {
    if (!wsSessionId && httpDraftQuery.data?.draftPrompt != null) {
      setRestoredDraft(httpDraftQuery.data.draftPrompt);
    }
  }, [wsSessionId, httpDraftQuery.data]);

  const pendingRef = useRef<string | null | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbSessionIdRef = useRef(dbSessionId);
  dbSessionIdRef.current = dbSessionId;
  const wsSessionIdRef = useRef(wsSessionId);
  wsSessionIdRef.current = wsSessionId;

  // Fetch draft from DB via WS on mount when session is initialized
  useEffect(() => {
    if (initialDraft != null || !wsSessionId || !isConnected || !dbSessionId) return;
    void sendRequest(wsSessionId, createDraftGet(dbSessionId)).then((payload) => {
      const data = payload as DraftResultPayload;
      if (data.draft != null) {
        setRestoredDraft(data.draft);
      }
    });
  }, [initialDraft, wsSessionId, isConnected, dbSessionId, sendRequest]);

  const flushSave = useCallback(() => {
    if (pendingRef.current === undefined) return;
    const sid = dbSessionIdRef.current;
    if (!sid) {
      pendingRef.current = undefined;
      return;
    }
    const draft = pendingRef.current;
    pendingRef.current = undefined;

    const wsSid = wsSessionIdRef.current;
    if (wsSid) {
      sendRaw(wsSid, createDraftSave(sid, draft));
    } else {
      saveDraftMutation.mutate({ sessionId: sid, draft });
    }
  }, [sendRaw, saveDraftMutation]);

  // Flush on unmount or dbSessionId change
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flushSave();
    };
  }, [dbSessionId, flushSave]);

  const saveDraft = useCallback(
    (text: string | null) => {
      if (!dbSessionId) return;
      pendingRef.current = text;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flushSave();
      }, 500);
    },
    [dbSessionId, flushSave],
  );

  return { initialDraft: restoredDraft, saveDraft };
}
