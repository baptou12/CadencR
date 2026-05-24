/**
 * Reflect `usePromptDraft` state into the prompt editor.
 *
 * On a real conversation switch (both old and new `dbSessionId` concrete and
 * different — e.g. /clear, feature switch without a remount) the editor is
 * blanked so the previous conversation's text doesn't leak. The async draft
 * fetch then repopulates via the restore-on-empty branch. A null → concrete
 * transition is *not* a switch — that's the WS session reaching its init'd
 * DB id, and any in-flight typing must survive.
 */
import { useEffect, useRef } from "react";
import type { PromptEditorHandle } from "@/components/prompt-editor/PromptEditor";

interface UsePromptEditorRestoreOptions {
  restoredDraft: string | null;
  dbSessionId: number | null;
  textRef: React.MutableRefObject<string>;
  editorRef: React.RefObject<PromptEditorHandle | null>;
  setText: (text: string) => void;
}

export function usePromptEditorRestore({
  restoredDraft,
  dbSessionId,
  textRef,
  editorRef,
  setText,
}: UsePromptEditorRestoreOptions): void {
  const prevDbSessionIdRef = useRef<number | null>(dbSessionId);
  useEffect(() => {
    const prev = prevDbSessionIdRef.current;
    prevDbSessionIdRef.current = dbSessionId;
    if (prev != null && dbSessionId != null && prev !== dbSessionId) {
      setText("");
      editorRef.current?.setText("");
      return;
    }
    if (restoredDraft && !textRef.current) {
      setText(restoredDraft);
      editorRef.current?.setText(restoredDraft);
    }
  }, [restoredDraft, dbSessionId, textRef, editorRef, setText]);
}
