import { Effect } from "effect";
import { getDatabase } from "../db/database";
import { getSessionDbId, persistClaudeSessionId, notifyDbUpdated } from "./session-persistence";
import { transitionAgentSession } from "./state-transitions";
import { resolveModel } from "./models";
import { loadAllowedPatterns } from "./permissions";
import { broadcast, AGENT_EVENT_CHANNEL } from "./broadcast";
import { AppRuntime } from "../effect/runtime";
import { SdkQueryRunner } from "../effect/services/SdkQueryRunner";
import type { AgentEvent, AgentType, MessageContent, StreamEvent, ManagedSubprocess, SubprocessOptions } from "./types";

export type { ManagedSubprocess, SubprocessOptions };

const activeProcesses = new Map<string, ManagedSubprocess>();

// ---------------------------------------------------------------------------
// Flush pending throttled DB notifications for a session.
// (Used by pauseSubprocess; throttledNotify logic moved to SdkQueryRunner/EventBroadcaster.
//  flushNotifyDbUpdated will be extracted in the SubprocessLifecycle phase.)
// ---------------------------------------------------------------------------
const pendingNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingNotifyFeatureIds = new Map<string, number>();

function flushNotifyDbUpdated(sessionKey: string): void {
  const timer = pendingNotifyTimers.get(sessionKey);
  if (timer) {
    clearTimeout(timer);
    pendingNotifyTimers.delete(sessionKey);
  }
  const fid = pendingNotifyFeatureIds.get(sessionKey);
  pendingNotifyFeatureIds.delete(sessionKey);
  if (fid != null) notifyDbUpdated("agent_session", fid);
}

/** Resolve the current model for a subprocess by looking up its feature and project. */
function resolveModelForSubprocess(agentType: AgentType, featureId: number): string | undefined {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT project_id FROM features WHERE id = ?").get(featureId) as { project_id: number } | undefined;
    return resolveModel(agentType, featureId, row?.project_id);
  } catch { return undefined; }
}

/** Resolve the feature ID for a managed subprocess (for throttled notifications). */
const featureIdCache = new Map<string, number>();
function getFeatureIdForSubprocess(managedId: string): number | null {
  const cached = featureIdCache.get(managedId);
  if (cached != null) return cached;
  const sessionDbId = getSessionDbId(managedId);
  if (!sessionDbId) return null;
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sessionDbId) as { feature_id: number } | undefined;
    if (row) { featureIdCache.set(managedId, row.feature_id); return row.feature_id; }
    return null;
  } catch { return null; }
}

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `agent-${Date.now()}-${idCounter}`;
}

/** Pre-generate a subprocess ID for use before startSubprocess is called. */
export function generateSubprocessId(): string {
  return generateId();
}

/**
 * Broadcast a stream event to all renderer windows.
 * (Still used by pauseSubprocess; will be extracted in SubprocessLifecycle phase.)
 */
function broadcastEvent(
  id: string,
  agentType: AgentType | string,
  event: StreamEvent,
  parentToolUseId?: string | null,
  messageDbId?: number | null,
): void {
  const agentEvent: AgentEvent = {
    subprocessId: id,
    agentType: agentType as AgentType,
    event,
    timestamp: Date.now(),
    parentToolUseId: parentToolUseId ?? undefined,
    sessionDbId: getSessionDbId(id),
    messageDbId: messageDbId ?? undefined,
  };

  broadcast(AGENT_EVENT_CHANNEL, agentEvent);
}

/**
 * Start a new Claude Agent SDK query.
 * Delegates the SDK lifecycle to SdkQueryRunner.execute() via the Effect runtime.
 */
export function startSubprocess(options: SubprocessOptions): ManagedSubprocess {
  const id = options.id ?? generateId();
  const abortController = new AbortController();

  const managed: ManagedSubprocess = {
    id,
    agentType: options.agentType,
    startedAt: new Date(),
    status: "running",
    abortController,
    eventListeners: [],
    completionListeners: [],
    originalOptions: options,
    worktreePath: options.worktreePath,
    cachedPermissions: options.worktreePath
      ? loadAllowedPatterns(options.worktreePath)
      : new Set<string>(),
  };

  activeProcesses.set(id, managed);

  // Delegate the SDK query lifecycle to SdkQueryRunner (Effect service)
  AppRuntime.runPromise(
    Effect.gen(function* () {
      const runner = yield* SdkQueryRunner;
      yield* runner.execute(managed, options);
    }),
  ).catch((err) => {
    // This catch only fires if SdkQueryRunner itself encounters an unexpected
    // top-level failure — all standard errors are handled by CompletionActions.
    console.error("[subprocess-manager] Unexpected SDK query error:", err);
  });

  return managed;
}

/**
 * Change the permission mode of a running subprocess at runtime.
 */
export async function setSubprocessPermissionMode(
  id: string,
  mode: "acceptEdits" | "plan",
): Promise<boolean> {
  const managed = activeProcesses.get(id);
  if (!managed || !managed.query || managed.status !== "running") return false;
  await managed.query.setPermissionMode(mode);
  return true;
}

export type SendMessageResult = {
  success: boolean;
  reason: "sent" | "resumed" | "no_process" | "invalid_status" | "no_resume_id" | "no_push";
};

/**
 * Send a user message to a running subprocess via the streaming input generator.
 * Returns a structured result so callers can distinguish failure modes and handle them.
 */
export function sendMessageToSubprocess(id: string, message: MessageContent): SendMessageResult {
  const managed = activeProcesses.get(id);
  if (!managed) return { success: false, reason: "no_process" };

  if (managed.status !== "running" && managed.status !== "paused" && managed.status !== "completed") {
    return { success: false, reason: "invalid_status" };
  }

  // Persist the user message to the database and notify renderer via DB update
  const sessionDbId = getSessionDbId(id);
  if (sessionDbId) {
    try {
      const db = getDatabase();
      const persistedContent = typeof message === "string" ? message : JSON.stringify(message);
      db.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
      ).run(sessionDbId, "user", persistedContent, "user_message", null);
      const fid = getFeatureIdForSubprocess(id);
      if (fid != null) notifyDbUpdated("agent_session", fid);
    } catch {
      // Best-effort persistence
    }
  }

  // Resume from paused or completed state — start a new query with resume session ID
  // If sdkSessionId is null (e.g. after /clear), start a fresh SDK query without resume
  if (managed.status === "paused" || managed.status === "completed") {
    if (!managed.originalOptions) {
      return { success: false, reason: "no_resume_id" };
    }
    managed.status = "running";
    // Update DB status back to running
    const resumeDbId = getSessionDbId(id);
    if (resumeDbId) {
      const db = getDatabase();
      transitionAgentSession(db, resumeDbId, "running", undefined, { ended_at: null });
    }
    // Fresh abort controller for the resumed query
    managed.abortController = new AbortController();
    // Re-resolve model in case user changed settings since session started
    let freshModel = managed.originalOptions.model;
    const fid = getFeatureIdForSubprocess(id);
    if (fid) {
      freshModel = resolveModelForSubprocess(managed.agentType as AgentType, fid) ?? freshModel;
    }
    const resumeOptions: SubprocessOptions = {
      ...managed.originalOptions,
      prompt: message,
      // Only include resumeSessionId if available (null after /clear → fresh context)
      ...(managed.sdkSessionId ? { resumeSessionId: managed.sdkSessionId } : {}),
      model: freshModel,
    };
    // Re-run the SDK query via SdkQueryRunner
    AppRuntime.runPromise(
      Effect.gen(function* () {
        const runner = yield* SdkQueryRunner;
        yield* runner.execute(managed, resumeOptions);
      }),
    ).catch((err) => {
      console.error(`[subprocess-manager] Resume SDK query failed for ${id}:`, err);
    });
    return { success: true, reason: "resumed" };
  }

  if (!managed.pushMessage) return { success: false, reason: "no_push" };

  // Re-resolve the model in case the user changed it in settings since the session started
  if (managed.query) {
    try {
      const fid = getFeatureIdForSubprocess(id);
      const freshModel = fid
        ? resolveModelForSubprocess(managed.agentType as AgentType, fid)
        : undefined;
      if (freshModel) {
        void managed.query.setModel(freshModel);
      }
    } catch { /* best-effort */ }
  }

  managed.pushMessage(message);
  return { success: true, reason: "sent" };
}

/**
 * Pause a subprocess — interrupts the SDK query and persists 'paused' status to DB
 * so the session can be resumed later (even after app restart).
 *
 * @param allowPaused - If true, also accepts already-paused subprocesses (used by stop).
 *                      If false, only running subprocesses can be paused (used by interrupt).
 */
export async function pauseSubprocess(id: string, opts?: { allowPaused?: boolean }): Promise<boolean> {
  const managed = activeProcesses.get(id);
  if (!managed) return false;

  const validStatuses = opts?.allowPaused
    ? ["running", "paused"]
    : ["running"];
  if (!validStatuses.includes(managed.status)) return false;

  managed.status = "paused";
  if (managed.query) {
    try { await managed.query.interrupt(); } catch { /* may already be done */ }
  } else {
    managed.abortController?.abort();
  }

  // Persist paused status to DB and clear subprocess_id (process will get a new one on resume)
  const sessionDbId = getSessionDbId(id);
  if (sessionDbId) {
    const db = getDatabase();
    transitionAgentSession(db, sessionDbId, "paused", undefined, { ended_at: new Date().toISOString(), subprocess_id: null });
    if (managed.sdkSessionId) persistClaudeSessionId(sessionDbId, managed.sdkSessionId);
  }

  flushNotifyDbUpdated(managed.id);
  broadcastEvent(managed.id, managed.agentType, { type: "agent_paused" });
  return true;
}

/** Stop a subprocess (accepts running or paused). Alias for pauseSubprocess with allowPaused. */
export async function stopSubprocess(id: string): Promise<boolean> {
  return pauseSubprocess(id, { allowPaused: true });
}

/** Interrupt a running subprocess. Alias for pauseSubprocess (running only). */
export async function interruptSubprocess(id: string): Promise<boolean> {
  return pauseSubprocess(id);
}

/**
 * List all active subprocesses.
 */
export function listSubprocesses(): Array<{
  id: string;
  agentType: string;
  startedAt: Date;
  status: string;
}> {
  return Array.from(activeProcesses.values()).map((m) => ({
    id: m.id,
    agentType: m.agentType,
    startedAt: m.startedAt,
    status: m.status,
  }));
}

/**
 * Kill all running subprocesses. Used during app shutdown.
 */
export function killAllSubprocesses(): void {
  for (const [, managed] of activeProcesses) {
    if (managed.status === "running") {
      managed.status = "stopped";
      managed.abortController?.abort();
    }
  }
}

// Re-export from extracted modules for backward compatibility
export { submitToolPermission, submitUserAnswers } from "./tool-permissions";
import { submitPlanApproval as _submitPlanApproval, submitPrdApproval as _submitPrdApproval } from "./tool-permissions";
export function submitPlanApproval(subprocessId: string, approved: boolean, feedback?: string) {
  return _submitPlanApproval(subprocessId, approved, feedback, getActiveProcess);
}
export function submitPrdApproval(subprocessId: string, approved: boolean, feedback?: string) {
  return _submitPrdApproval(subprocessId, approved, feedback, getActiveProcess);
}
import { getSupportedCommands as _getSupportedCommands } from "./slash-commands";
export function getSupportedCommands(subprocessId: string | null, cwd: string) {
  return _getSupportedCommands(subprocessId, cwd, getActiveProcess);
}

/**
 * Check if any subprocesses are currently running.
 */
export function hasRunningSubprocesses(): boolean {
  for (const [, managed] of activeProcesses) {
    if (managed.status === "running") {
      return true;
    }
  }
  return false;
}

/**
 * Mark all running agent sessions as 'paused' in the database.
 * Called during app shutdown to preserve session state for resume.
 */
export function saveAllSessionStates(): void {
  try {
    const db = getDatabase();
    // Mark running sessions as paused and clear subprocess_id since the process is dead.
    // Preserve pending_plan_approval so the approval bar still shows after restart.
    db.prepare(
      "UPDATE agent_sessions SET status = 'paused', ended_at = datetime('now'), subprocess_id = NULL WHERE status = 'running'",
    ).run();
    // Reset running phases — no subprocess can be executing them after shutdown
    db.prepare("UPDATE phases SET status = 'pending' WHERE status = 'running'").run();
    // Clear subprocess_id for completed/paused/error sessions since the process is dead after restart
    db.prepare(
      "UPDATE agent_sessions SET subprocess_id = NULL WHERE status IN ('completed', 'paused', 'error') AND subprocess_id IS NOT NULL",
    ).run();
  } catch {
    // Best-effort: database may already be closed
  }
}

/**
 * Gracefully shut down all subprocesses and save session state.
 */
export function gracefulShutdown(): void {
  saveAllSessionStates();
  killAllSubprocesses();
}

/** Get an active process by ID (used by slash-commands module). */
export function getActiveProcess(id: string): ManagedSubprocess | undefined {
  return activeProcesses.get(id);
}

// Re-export channel constants for use in preload and main
export { ASK_USER_QUESTION_CHANNEL, ASK_USER_ANSWER_CHANNEL, TOOL_PERMISSION_CHANNEL } from "./broadcast";
