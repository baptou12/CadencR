/**
 * Session Agent — thin wrapper that builds a UnifiedAgentConfig and delegates
 * to startUnifiedAgent.
 *
 * The simplest agent — no output patterns or completion actions.
 */

import { startUnifiedAgent, type UnifiedAgentResult } from "./unified-agent";
import { createSessionConfig } from "./agent-configs";
import type { AgentType } from "./types";

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
  /** Permission mode for the subprocess */
  permissionMode?: "bypassPermissions" | "plan";
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
  const config = createSessionConfig({
    featureId: options.featureId,
    projectId: options.projectId,
    cwd: options.cwd,
    prompt: options.prompt,
    resumeSessionId: options.resumeSessionId,
    permissionMode: options.permissionMode,
  });

  const result: UnifiedAgentResult = startUnifiedAgent(config);

  return {
    subprocessId: result.subprocessId,
    agentType: result.agentType,
    sessionDbId: result.sessionDbId,
  };
}
