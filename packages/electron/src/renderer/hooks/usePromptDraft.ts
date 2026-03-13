/**
 * Hook for persisting per-agent-session draft prompt text.
 * Debounces DB saves (500ms) and flushes on unmount.
 */

import { useEffect, useRef, useCallback } from "react";
import { trpc } from "@/trpc";

interface UsePromptDraftOptions {
  sessionId: number | undefined;
  initialDraft: string | null;
}

export function usePromptDraft({ sessionId, initialDraft }: UsePromptDraftOptions) {
  const saveDraftMutation = trpc.sessions.saveDraft.useMutation();

  // Pending debounced save value
  const pendingRef = useRef<string | null | undefined>(undefined); // undefined = no pending save
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const flushSave = useCallback(() => {
    if (pendingRef.current === undefined) return;
    if (!sessionIdRef.current) {
      pendingRef.current = undefined;
      return;
    }
    const draft = pendingRef.current;
    pendingRef.current = undefined;
    saveDraftMutation.mutate({ sessionId: sessionIdRef.current, draft });
  }, [saveDraftMutation]);

  // Flush on unmount or sessionId change
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flushSave();
    };
  }, [sessionId, flushSave]);

  const saveDraft = useCallback(
    (text: string | null) => {
      if (!sessionId) return;
      pendingRef.current = text;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flushSave();
      }, 500);
    },
    [sessionId, flushSave],
  );

  return { initialDraft, saveDraft };
}
