/**
 * Stable string identity for a conversation, namespaced so WS and HTTP
 * sessions with the same numeric id can never collide. Shared between the
 * in-memory draft cache (`usePromptDraft`) and the editor-reset gate
 * (`usePromptEditorRestore`) so they always agree on what counts as a
 * different conversation.
 */
export function draftScope(
  sessionId: number | undefined,
  wsSessionId: string | undefined,
): string | null {
  if (wsSessionId) return `ws:${wsSessionId}`;
  return sessionId != null ? `http:${sessionId}` : null;
}
