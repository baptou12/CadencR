/**
 * Session Agent — free-form Claude Code session.
 *
 * Provides an open-ended chat/agent experience without structured output parsing.
 * Supports starting new sessions, resuming existing ones, multi-turn messaging,
 * and interrupt/resume.
 */

import { getDatabase } from "../db/database";
import { startSubprocess } from "./subprocess-manager";
import { bridgeSubprocessToRenderer } from "./ipc-bridge";
import { resolveModel } from "./models";
import type { AgentType } from "./types";

const SESSION_SYSTEM_PROMPT =
  "You are Claude Code working on this project. Help the user with whatever they need.";

export interface SessionAgentOptions {
  /** Feature ID (optional — session can run without a feature) */
  featureId?: number;
  /** Project ID */
  projectId: number;
  /** User prompt */
  prompt: string;
  /** Working directory (project root or worktree path) */
  cwd: string;
  /** Existing Claude session ID to resume */
  resumeSessionId?: string;
}

export interface SessionAgentResult {
  subprocessId: string;
  agentType: AgentType;
  sessionDbId: number;
}

/**
 * Start a free-form session agent.
 */
export function startSessionAgent(options: SessionAgentOptions): SessionAgentResult {
  const db = getDatabase();

  // Create agent session record
  const sessionResult = db
    .prepare(
      "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at) VALUES (?, ?, ?, datetime('now'))",
    )
    .run(options.featureId ?? null, "session", "running");
  const sessionDbId = Number(sessionResult.lastInsertRowid);

  const model = resolveModel("session", options.featureId, options.projectId);

  const managed = startSubprocess({
    cwd: options.cwd,
    agentType: "session",
    systemPrompt: SESSION_SYSTEM_PROMPT,
    prompt: options.prompt,
    resumeSessionId: options.resumeSessionId,
    model,
  });

  // Bridge to renderer — no completion handler needed, just raw streaming
  bridgeSubprocessToRenderer(managed, "session", sessionDbId);

  // Persist the initial user message
  if (options.prompt) {
    db.prepare(
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
    ).run(sessionDbId, "user", options.prompt, "user_message", null);
  }

  // Update session status on completion
  managed.completionListeners.push((code: number) => {
    const db2 = getDatabase();
    db2.prepare(
      "UPDATE agent_sessions SET status = ?, ended_at = datetime('now') WHERE id = ?",
    ).run(code === 0 ? "completed" : "error", sessionDbId);
  });

  return {
    subprocessId: managed.id,
    agentType: "session",
    sessionDbId,
  };
}
