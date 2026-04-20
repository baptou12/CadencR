/**
 * WebSocket envelope utilities for communicating with the Rust Axum WS endpoint.
 *
 * Mirrors the WsEnvelope struct in packages/service/src/domain/ws_session/protocol.rs.
 */

export interface WsEnvelope {
  id: string;
  domain: string;
  action: string;
  ref?: string;
  payload: unknown;
}

export interface SessionConfig {
  provider?: string;
  model?: string;
  thinkingEffort?: string;
  permissionMode?: string;
  systemPrompt?: string;
  cwd?: string;
  featureId?: number;
}

export function createEnvelope(domain: string, action: string, payload: unknown): WsEnvelope {
  return {
    id: crypto.randomUUID(),
    domain,
    action,
    payload,
  };
}

export function parseEnvelope(raw: string): WsEnvelope {
  const parsed = JSON.parse(raw);
  if (!parsed.domain || !parsed.action) {
    throw new Error("Invalid envelope: missing domain or action");
  }
  return parsed as WsEnvelope;
}

export function createSessionInit(config: SessionConfig): WsEnvelope {
  return createEnvelope("session", "init", {
    provider: config.provider ?? null,
    model: config.model ?? null,
    thinking_effort: config.thinkingEffort ?? null,
    permission_mode: config.permissionMode ?? null,
    system_prompt: config.systemPrompt ?? null,
    cwd: config.cwd ?? null,
    feature_id: config.featureId ?? null,
  });
}

export function createPromptSend(
  sessionId: string,
  text: string,
  images?: Array<{ base64: string; mimeType: string }>,
  useWorktree?: boolean,
): WsEnvelope {
  return createEnvelope("session", "prompt.send", {
    session_id: sessionId,
    text,
    ...(images && images.length > 0 ? { images } : {}),
    ...(useWorktree ? { use_worktree: true } : {}),
  });
}

export function createPermissionRespond(
  sessionId: string,
  requestId: string,
  decision: "allow_once" | "allow_future" | "deny",
  updatedInput?: Record<string, unknown>,
  feedback?: string,
): WsEnvelope {
  return createEnvelope("session", "permission.respond", {
    session_id: sessionId,
    request_id: requestId,
    decision,
    ...(updatedInput ? { updated_input: updatedInput } : {}),
    ...(feedback ? { feedback } : {}),
  });
}

export function createInterrupt(sessionId: string): WsEnvelope {
  return createEnvelope("session", "interrupt", { session_id: sessionId });
}

export function createModelSet(sessionId: string, model: string): WsEnvelope {
  return createEnvelope("session", "model.set", { session_id: sessionId, model });
}

export function createProviderSet(sessionId: string, provider: string): WsEnvelope {
  return createEnvelope("session", "provider.set", { session_id: sessionId, provider });
}

export function createModeSet(sessionId: string, mode: string): WsEnvelope {
  return createEnvelope("session", "mode.set", { session_id: sessionId, mode });
}

export function createEffortSet(sessionId: string, thinkingEffort?: string): WsEnvelope {
  return createEnvelope("session", "effort.set", {
    session_id: sessionId,
    thinking_effort: thinkingEffort ?? null,
  });
}

export function createDestroy(sessionId: string): WsEnvelope {
  return createEnvelope("session", "destroy", { session_id: sessionId });
}

export function createSessionClear(sessionId: string): WsEnvelope {
  return createEnvelope("session", "clear", { session_id: sessionId });
}

export function createSessionDelete(sessionId: string): WsEnvelope {
  return createEnvelope("session", "delete", { session_id: sessionId });
}

export function createCommandsGet(cwd: string, provider?: string): WsEnvelope {
  return createEnvelope("commands", "get", provider ? { cwd, provider } : { cwd });
}

export interface CommandsListPayload {
  commands: Array<{ name: string; description?: string }>;
}

export function createHistoryGet(projectId: number): WsEnvelope {
  return createEnvelope("session", "history.get", { project_id: projectId });
}

export function createHistoryAdd(projectId: number, content: string): WsEnvelope {
  return createEnvelope("session", "history.add", { project_id: projectId, content });
}

export function createDraftGet(sessionId: number): WsEnvelope {
  return createEnvelope("session", "draft.get", { session_id: sessionId });
}

export function createDraftSave(sessionId: number, draft: string | null): WsEnvelope {
  return createEnvelope("session", "draft.save", { session_id: sessionId, draft });
}
