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
  model?: string;
  permissionMode?: string;
  systemPrompt?: string;
  cwd?: string;
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
    model: config.model ?? null,
    permission_mode: config.permissionMode ?? null,
    system_prompt: config.systemPrompt ?? null,
    cwd: config.cwd ?? null,
  });
}

export function createPromptSend(text: string): WsEnvelope {
  return createEnvelope("session", "prompt.send", { text });
}

export function createPermissionRespond(requestId: string, granted: boolean): WsEnvelope {
  return createEnvelope("session", "permission.respond", {
    request_id: requestId,
    granted,
  });
}

export function createInterrupt(): WsEnvelope {
  return createEnvelope("session", "interrupt", {});
}

export function createDestroy(): WsEnvelope {
  return createEnvelope("session", "destroy", {});
}
