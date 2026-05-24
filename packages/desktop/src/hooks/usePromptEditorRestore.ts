/**
 * Reflect `usePromptDraft` state into the prompt editor.
 *
 * The prompt bar is reused across conversation switches (the React subtree
 * doesn't unmount on a route param change), so we blank the editor whenever
 * either of two independent signals fires:
 *   - `conversationKey` changes — user navigated to a different conversation.
 *     Destination may be uninitialized (`dbSessionId == null`) yet still
 *     distinct from the source, so we cannot gate this on dbSessionId.
 *   - `dbSessionId` rolls between two concrete values within the same key —
 *     `/clear` mints a fresh `agent_sessions` row inside the same feature.
 *
 * A `null → concrete` `dbSessionId` transition with an unchanged
 * `conversationKey` is the WS session reaching its init'd DB id — in-flight
 * typing must survive. After a blank, the async draft fetch repopulates via
 * the restore-on-empty branch.
 */
import { useEffect, useRef } from "react";
import type { PromptEditorHandle } from "@/components/prompt-editor/PromptEditor";

interface UsePromptEditorRestoreOptions {
  restoredDraft: string | null;
  dbSessionId: number | null;
  /**
   * Stable identifier for the current conversation. Typically the WS session
   * id from the route; for HTTP-only callers, a string derived from
   * `sessionId`. `null` means "no conversation bound yet" — treated as
   * inert so first-mount doesn't trigger a phantom reset.
   */
  conversationKey: string | null;
  textRef: React.MutableRefObject<string>;
  editorRef: React.RefObject<PromptEditorHandle | null>;
  setText: (text: string) => void;
}

export function usePromptEditorRestore({
  restoredDraft,
  dbSessionId,
  conversationKey,
  textRef,
  editorRef,
  setText,
}: UsePromptEditorRestoreOptions): void {
  const prevDbSessionIdRef = useRef<number | null>(dbSessionId);
  const prevConversationKeyRef = useRef<string | null>(conversationKey);
  useEffect(() => {
    const prevDb = prevDbSessionIdRef.current;
    const prevKey = prevConversationKeyRef.current;
    prevDbSessionIdRef.current = dbSessionId;
    prevConversationKeyRef.current = conversationKey;

    const conversationSwitched =
      prevKey != null && conversationKey != null && prevKey !== conversationKey;
    const dbSessionRolled = prevDb != null && dbSessionId != null && prevDb !== dbSessionId;

    if (conversationSwitched || dbSessionRolled) {
      setText("");
      editorRef.current?.setText("");
      return;
    }
    if (restoredDraft && !textRef.current) {
      setText(restoredDraft);
      editorRef.current?.setText(restoredDraft);
    }
  }, [restoredDraft, dbSessionId, conversationKey, textRef, editorRef, setText]);
}
