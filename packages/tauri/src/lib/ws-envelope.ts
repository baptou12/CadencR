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
    model: config.model ?? null,
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

export function createModeSet(sessionId: string, mode: string): WsEnvelope {
  return createEnvelope("session", "mode.set", { session_id: sessionId, mode });
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

export function createCommandsGet(cwd: string): WsEnvelope {
  return createEnvelope("commands", "get", { cwd });
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

// ---------------------------------------------------------------------------
// Custom workflow phase envelopes
// ---------------------------------------------------------------------------

export function createPhaseApproval(
  featureId: number,
  phaseSlug: string,
  approved: boolean,
  feedback?: string,
): WsEnvelope {
  return createEnvelope("workflow", "phase_approval", {
    feature_id: featureId,
    phase_slug: phaseSlug,
    approved,
    ...(feedback ? { feedback } : {}),
  });
}

export function createPhaseTrigger(featureId: number, phaseSlug: string): WsEnvelope {
  return createEnvelope("workflow", "phase_trigger", {
    feature_id: featureId,
    phase_slug: phaseSlug,
  });
}

export function createCustomWorkflowStart(
  featureId: number,
  projectId: number,
  title: string,
  workflowDefinitionId: number,
  description?: string,
): WsEnvelope {
  return createEnvelope("workflow", "feature_start_custom", {
    feature_id: featureId,
    project_id: projectId,
    title,
    workflow_definition_id: workflowDefinitionId,
    ...(description ? { description } : {}),
  });
}
