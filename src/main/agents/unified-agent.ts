/**
 * Unified Agent — the single entry-point for starting any agent type.
 *
 * All agent types (plan, brainstorm, execute, risk, review, session) can be
 * started via `startUnifiedAgent()` by providing the appropriate
 * `UnifiedAgentConfig`.  The function:
 *
 *   1. Creates a session record in the database
 *   2. Spawns a Claude CLI subprocess via the subprocess manager
 *   3. Bridges events to the renderer
 *   4. Accumulates output text for completion actions
 *   5. Runs completion actions when the subprocess exits
 *
 * This generalises the logic that was previously copy-pasted across the
 * individual agent start functions.
 */

import fs from "node:fs";
import { getDatabase } from "../db/database";
import { startSubprocess, generateSubprocessId } from "./subprocess-manager";
import { registerSessionPersistence } from "./session-persistence";
import { transitionAgentSession } from "./state-transitions";
import { resolveModel } from "./models";
import { extractTextFromEvent } from "./utils";
import type {
  AgentType,
  StreamEvent,
  UnifiedAgentConfig,
} from "./types";

/** Result returned after starting a unified agent. */
export interface UnifiedAgentResult {
  /** The subprocess ID (used for IPC, stop/interrupt, and sending messages) */
  subprocessId: string;
  /** The agent type */
  agentType: AgentType;
  /** The database session ID */
  sessionDbId: number;
}

/**
 * Start an agent using a unified configuration.
 *
 * This is the generalised version of the per-agent start functions
 * (`startPlanAgent`, `startSessionAgent`, etc.).  Each caller supplies
 * config that describes system prompt, output patterns, and completion
 * actions — everything else is handled uniformly.
 */
export function startUnifiedAgent(config: UnifiedAgentConfig): UnifiedAgentResult {
  // 0. Validate CWD exists and is a directory
  if (!fs.existsSync(config.cwd)) {
    throw new Error(
      `Agent working directory does not exist: ${config.cwd}. The worktree may not have been created yet or was removed.`,
    );
  }
  const cwdStat = fs.statSync(config.cwd);
  if (!cwdStat.isDirectory()) {
    throw new Error(
      `Agent working directory is not a directory: ${config.cwd}`,
    );
  }

  const db = getDatabase();

  // 1. Resolve model
  const model = resolveModel(config.agentType, config.featureId, config.projectId);

  // 2. Create or reuse agent session record
  let sessionDbId: number;
  if (config.existingSessionDbId) {
    // Resume: reuse existing session row
    sessionDbId = config.existingSessionDbId;
    db.prepare(
      "UPDATE agent_sessions SET status = 'running', started_at = datetime('now'), ended_at = NULL, model = ?, pending_questions = NULL WHERE id = ?",
    ).run(model, sessionDbId);
  } else {
    const sessionResult = db
      .prepare(
        "INSERT INTO agent_sessions (feature_id, agent_type, status, started_at, run_id, phase_id, model, permission_mode) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)",
      )
      .run(config.featureId ?? null, config.agentType, "running", config.runId ?? null, config.phaseId ?? null, model, config.permissionMode ?? "acceptEdits");
    sessionDbId = Number(sessionResult.lastInsertRowid);
  }

  // 3. Resolve MCP servers — use factory if provided (needs subprocess ID).
  //    We pre-generate the ID so the factory can capture it before subprocess spawn.
  let mcpServers = config.mcpServers;
  const preGeneratedId = config.mcpServerFactory ? generateSubprocessId() : undefined;

  if (config.mcpServerFactory && preGeneratedId) {
    mcpServers = config.mcpServerFactory(preGeneratedId, sessionDbId);
  }

  // 3a. Spawn subprocess
  const managed = startSubprocess({
    cwd: config.cwd,
    agentType: config.agentType,
    systemPrompt: config.systemPrompt,
    prompt: config.prompt,
    resumeSessionId: config.resumeSessionId,
    model,
    permissionMode: config.permissionMode,
    worktreePath: config.worktreePath ?? config.cwd,
    mcpServers,
    id: preGeneratedId,
  });

  // 3b. Persist subprocess ID to DB for reconnection after refresh
  db.prepare("UPDATE agent_sessions SET subprocess_id = ? WHERE id = ?").run(managed.id, sessionDbId);

  // 4. Register session for persistence tracking
  registerSessionPersistence(managed.id, sessionDbId);

  // 5. Persist the initial user message
  if (config.prompt) {
    db.prepare(
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
    ).run(sessionDbId, "user", config.prompt, "user_message", null);
  }

  // 6. Accumulate output for completion actions
  let fullOutput = "";

  managed.eventListeners.push((event: StreamEvent) => {
    const text = extractTextFromEvent(event);
    if (text) {
      fullOutput += text;
    }
  });

  // 7. Completion handling
  managed.completionListeners.push(async (exitCode: number) => {
    const db2 = getDatabase();

    // Don't overwrite 'paused' status — it was already set by stop/interrupt
    const current = db2.prepare("SELECT status FROM agent_sessions WHERE id = ?").get(sessionDbId) as { status: string } | undefined;
    const wasInterrupted = current?.status === "paused";

    if (!wasInterrupted) {
      // Update session status
      transitionAgentSession(db2, sessionDbId, exitCode === 0 ? "completed" : "error", config.featureId, { ended_at: "datetime('now')" });
    }

    // Safety-net: persist session ID if not yet saved
    if (managed.sdkSessionId) {
      db2.prepare("UPDATE agent_sessions SET claude_session_id = ? WHERE id = ? AND claude_session_id IS NULL")
        .run(managed.sdkSessionId, sessionDbId);
    }

    // Always run completion actions — even on interrupt — so that callers
    // waiting on promises (e.g. execute orchestrator) can settle.
    if (config.completionActions) {
      const context = {
        agentType: config.agentType,
        exitCode,
        sessionDbId,
        featureId: config.featureId,
        projectId: config.projectId,
      };

      for (const action of config.completionActions) {
        try {
          await action.handler(fullOutput, context);
        } catch (err) {
          console.error(
            `[unified-agent] Completion action "${action.event}" failed:`,
            err,
          );
        }
      }
    }
  });

  return {
    subprocessId: managed.id,
    agentType: config.agentType,
    sessionDbId,
  };
}

