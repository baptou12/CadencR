import { getDatabase } from "../db/database";
import { resolveSetting } from "../db/settings";
import { discoverClaudeCli } from "./cli-discovery";
import { getSessionDbId, persistStreamEvent, persistClaudeSessionId, notifyDbUpdated, setSessionModel } from "./session-persistence";
import { transitionAgentSession } from "./state-transitions";
import { DEFAULT_MODEL, resolveModel } from "./models";
import { loadAllowedPatterns } from "./permissions";
import { broadcast, AGENT_EVENT_CHANNEL } from "./broadcast";
import { addBackgroundTask, updateBackgroundTask, clearBackgroundTasks } from "./background-tasks";
import { getSdkClient } from "./sdk-client";
import { createCanUseToolHandler } from "./tool-permissions";
import type { AgentEvent, AgentType, MessageContent, StreamEvent, ManagedSubprocess, SubprocessOptions } from "./types";

export type { ManagedSubprocess, SubprocessOptions };

const activeProcesses = new Map<string, ManagedSubprocess>();

// ---------------------------------------------------------------------------
// Throttled DB update notifications — batches rapid stream events into
// a single notifyDbUpdated call per session every 200ms.
// ---------------------------------------------------------------------------
const pendingNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingNotifyFeatureIds = new Map<string, number>();

function throttledNotifyDbUpdated(sessionKey: string, featureId: number): void {
  pendingNotifyFeatureIds.set(sessionKey, featureId);
  if (pendingNotifyTimers.has(sessionKey)) return; // already scheduled
  pendingNotifyTimers.set(
    sessionKey,
    setTimeout(() => {
      pendingNotifyTimers.delete(sessionKey);
      const fid = pendingNotifyFeatureIds.get(sessionKey);
      pendingNotifyFeatureIds.delete(sessionKey);
      if (fid != null) notifyDbUpdated("agent_session", fid);
    }, 200),
  );
}

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

/** Persist session status to DB (best-effort). Used on completed/stopped/error transitions. */
function persistSessionStatus(managedId: string, status: string, sdkSessionId?: string): void {
  const dbId = getSessionDbId(managedId);
  if (!dbId) return;
  try {
    const db = getDatabase();
    const extras: Record<string, unknown> = { ended_at: new Date().toISOString() };
    if (status === "error") {
      extras.subprocess_id = null;
    }
    transitionAgentSession(db, dbId, status as import("./state-transitions").AgentSessionStatus, undefined, extras);
    if (sdkSessionId) persistClaudeSessionId(dbId, sdkSessionId);
  } catch (e) {
    console.warn("[subprocess-manager] Failed to persist session status:", e);
  }
}

/**
 * Broadcast a stream event to all renderer windows.
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

// ---------------------------------------------------------------------------
/**
 * Convert an SDK message to StreamEvent(s) and broadcast them.
 */
function handleSdkMessage(
  managed: ManagedSubprocess,
  msg: Record<string, unknown>,
): void {
  const { id, agentType } = managed;
  const type = msg.type as string;
  const parentToolUseId =
    (msg.parent_tool_use_id as string | null | undefined) ?? null;

  // Persist events to agent_messages table
  const sessionDbId = getSessionDbId(id);

  if (type === "stream_event") {
    // SDKPartialAssistantMessage — contains the granular content_block_start/delta/stop events
    const innerEvent = msg.event as StreamEvent;
    if (innerEvent) {
      if (sessionDbId) persistStreamEvent(sessionDbId, innerEvent, parentToolUseId);
      // Throttled DB notification instead of broadcasting raw stream events
      const fid = getFeatureIdForSubprocess(id);
      if (fid != null) throttledNotifyDbUpdated(id, fid);
      for (const listener of managed.eventListeners) listener(innerEvent);
    }
  } else if (type === "assistant") {
    // Full assistant message — extract text and tool_use content blocks
    // Extract usage: total input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
    const message = msg.message as Record<string, unknown> | undefined;
    if (sessionDbId && message) {
      const usage = message.usage as {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      } | undefined;
      if (usage) {
        const totalInput = (usage.input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0);
        const totalOutput = usage.output_tokens ?? 0;
        try {
          const db2 = getDatabase();
          db2.prepare("UPDATE agent_sessions SET input_tokens = ?, output_tokens = ? WHERE id = ?")
            .run(totalInput, totalOutput, sessionDbId);
        } catch (e) { console.warn("[subprocess-manager] best-effort op failed:", e); }
      }
    }
    if (message) {
      // Capture the model from the full assistant message for per-message tracking
      if (sessionDbId && typeof message.model === "string") {
        setSessionModel(sessionDbId, message.model);
      }
      const content = message.content as
        | Array<Record<string, unknown>>
        | undefined;
      // Content blocks from the *parent* agent are already persisted via the
      // stream_event handler (includePartialMessages).  However, subagent turns
      // (parent_tool_use_id != null) do NOT produce stream_event messages, so we
      // must persist their content blocks here from the full assistant message.
      if (content) {
        const isSubagent = !!parentToolUseId;
        if (isSubagent && sessionDbId) {
          for (const block of content) {
            if (block.type === "text" && typeof block.text === "string" && block.text) {
              persistStreamEvent(sessionDbId, {
                type: "content_block_start",
                index: 0,
                content_block: { type: "text", text: block.text },
              } as StreamEvent, parentToolUseId);
            } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
              persistStreamEvent(sessionDbId, {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: block.thinking },
              } as StreamEvent, parentToolUseId);
            } else if (block.type === "tool_use") {
              persistStreamEvent(sessionDbId, {
                type: "content_block_start",
                index: 0,
                content_block: {
                  type: "tool_use",
                  id: block.id as string,
                  name: block.name as string,
                  input: block.input as Record<string, unknown>,
                },
              } as StreamEvent, parentToolUseId);
            }
          }
          const fid = getFeatureIdForSubprocess(id);
          if (fid != null) throttledNotifyDbUpdated(id, fid);
        }
        for (let i = 0; i < content.length; i++) {
          const block = content[i];
          if (block.type === "tool_use") {
            const toolName = block.name as string;
            const toolInput = block.input as Record<string, unknown>;

            // Detect EnterPlanMode tool call — update DB so UI reflects plan mode.
            if (toolName === "EnterPlanMode" && sessionDbId) {
              try {
                const db2 = getDatabase();
                db2.prepare("UPDATE agent_sessions SET permission_mode = 'plan' WHERE id = ?").run(sessionDbId);
                const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sessionDbId) as { feature_id: number } | undefined;
                if (row) notifyDbUpdated("agent_session", row.feature_id);
              } catch (e) { console.warn("[subprocess-manager] best-effort op failed:", e); }
            }

            // Detect background Bash tasks
            if (toolName === "Bash" && toolInput.run_in_background === true) {
              const tempId = block.id as string;
              addBackgroundTask(id, {
                id: tempId,
                tempId,
                subprocessId: id,
                kind: "bash",
                status: "running",
                command: typeof toolInput.command === "string" ? toolInput.command : undefined,
                spawnedAt: Date.now(),
              });
            }

            // Detect background Task (agent) spawns
            if ((toolName === "Task" || toolName === "Agent") && toolInput.run_in_background === true) {
              const tempId = block.id as string;
              addBackgroundTask(id, {
                id: tempId,
                tempId,
                subprocessId: id,
                kind: "agent",
                status: "running",
                spawnedAt: Date.now(),
              });
            }
          }
        }
      }
    }
  } else if (type === "user") {
    // User messages may contain tool_result content blocks (the SDK sends tool
    // results back to Claude as user messages).  Extract and persist/broadcast them.
    const message = msg.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (content && Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "tool_result") {
            const resultContent = typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? (block.content as Array<Record<string, unknown>>)
                    .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
                    .join("")
                : JSON.stringify(block.content ?? "");
            const toolResultEvent: StreamEvent = {
              type: "tool_result",
              tool_use_id: (block.tool_use_id as string) ?? "",
              content: resultContent,
              is_error: (block.is_error as boolean) ?? false,
            };
            if (sessionDbId) persistStreamEvent(sessionDbId, toolResultEvent, parentToolUseId);

            // Extract real task IDs from background task tool_results
            const toolUseId = block.tool_use_id as string | undefined;
            if (toolUseId && resultContent) {
              // Try to parse shell_id from Bash background task result
              const shellIdMatch = resultContent.match(/"?shell_?[Ii][Dd]"?\s*[:=]\s*"?([^",}\s]+)"?/);
              const taskIdMatch = resultContent.match(/"?task_?[Ii][Dd]"?\s*[:=]\s*"?([^",}\s]+)"?/);
              if (shellIdMatch?.[1]) {
                updateBackgroundTask(id, toolUseId, { id: shellIdMatch[1] });
              } else if (taskIdMatch?.[1]) {
                updateBackgroundTask(id, toolUseId, { id: taskIdMatch[1] });
              }
            }
          }
        }
        // Throttled DB notification for user tool results
        const fid3 = getFeatureIdForSubprocess(id);
        if (fid3 != null) throttledNotifyDbUpdated(id, fid3);
      }
    }
  } else if (type === "tool_result" || type === "result") {
    // tool_result: fallback for older SDK versions (current SDK sends tool results inside "user" messages)
    if (type === "tool_result") {
      const toolResultEvent: StreamEvent = {
        type: "tool_result",
        tool_use_id: (msg.tool_use_id as string) ?? "",
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
        is_error: (msg.is_error as boolean) ?? false,
      };
      if (sessionDbId) persistStreamEvent(sessionDbId, toolResultEvent, parentToolUseId);
      const fid4 = getFeatureIdForSubprocess(id);
      if (fid4 != null) throttledNotifyDbUpdated(id, fid4);
    } else {
      broadcastEvent(
        id,
        agentType,
        {
          type: "result",
          result: msg.result as string | undefined,
          cost_usd: msg.cost_usd as number | undefined,
          duration_ms: msg.duration_ms as number | undefined,
        },
        parentToolUseId,
      );
      if (agentType === "session") {
        // Session agents stay alive between turns — broadcast turn_complete
        // but keep the message stream open for follow-up messages.
        broadcastEvent(id, agentType, { type: "turn_complete" });
      } else {
        // Non-session agents: close the message stream so the for-await loop exits
        if (managed.closeMessageStream) {
          managed.closeMessageStream();
        }
      }
    }
  } else if (type === "system") {
    // Capture SDK session ID for resume after interrupt
    if (msg.session_id && typeof msg.session_id === "string") {
      managed.sdkSessionId = msg.session_id;
      // Persist to DB immediately so it survives app restart
      const sDbId = getSessionDbId(id);
      if (sDbId) {
        persistClaudeSessionId(sDbId, msg.session_id);
      }
    }
    // Track compaction events and task notifications
    const subtype = (msg.subtype as string) ?? "unknown";

    // SDKTaskNotificationMessage — background agent task completed/failed/stopped
    if (subtype === "task_notification") {
      const taskId = msg.task_id as string | undefined;
      const taskStatus = msg.status as string | undefined;
      const taskSummary = msg.summary as string | undefined;
      const outputFile = msg.output_file as string | undefined;
      if (taskId) {
        const update: Partial<import("./background-tasks").BackgroundTask> = {
          status: (taskStatus === "completed" || taskStatus === "failed" || taskStatus === "stopped")
            ? taskStatus
            : "completed",
          completedAt: Date.now(),
        };
        if (taskSummary) update.summary = taskSummary;
        if (outputFile) update.outputFile = outputFile;
        updateBackgroundTask(id, taskId, update);
      }
    }

    if (subtype === "compact_boundary" && sessionDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET was_compacted = 1 WHERE id = ?").run(sessionDbId);
      } catch (e) { console.warn("[subprocess-manager] best-effort op failed:", e); }
    }
    // System events are persisted to DB (e.g. compact_boundary); use throttled notify
    const fid5 = getFeatureIdForSubprocess(id);
    if (fid5 != null) throttledNotifyDbUpdated(id, fid5);
  }
}

/**
 * Start a new Claude Agent SDK query.
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

  // Start the SDK query asynchronously
  runSdkQuery(managed, options).catch((err) => {
    console.error("[subprocess-manager] SDK query error:", err);
    managed.status = "error";
    flushNotifyDbUpdated(id);
    broadcastEvent(id, options.agentType, {
      type: "error",
      error: {
        type: "sdk_error",
        message: err instanceof Error ? err.message : String(err),
      },
    });
  });

  return managed;
}

/**
 * Creates an async generator that yields user messages on demand.
 * The initial prompt is yielded immediately, and subsequent messages
 * are pushed via the returned `push` function.
 */
function createMessageStream(initialPrompt: MessageContent) {
  // Queue of pending messages and a resolver for the current wait
  const queue: MessageContent[] = [];
  let resolver: ((value: IteratorResult<unknown, void>) => void) | null = null;
  let done = false;

  function push(message: MessageContent) {
    if (done) return;
    if (resolver) {
      const r = resolver;
      resolver = null;
      r({
        done: false,
        value: {
          type: "user" as const,
          message: { role: "user" as const, content: message },
          parent_tool_use_id: null,
          session_id: "",
        },
      });
    } else {
      queue.push(message);
    }
  }

  function close() {
    done = true;
    if (resolver) {
      const r = resolver;
      resolver = null;
      r({ done: true, value: undefined });
    }
  }

  const generator: AsyncGenerator<unknown, void> = {
    next(): Promise<IteratorResult<unknown, void>> {
      // Yield initial prompt first
      if (initialPrompt) {
        const prompt = initialPrompt;
        initialPrompt = "";
        return Promise.resolve({
          done: false,
          value: {
            type: "user" as const,
            message: { role: "user" as const, content: prompt as MessageContent },
            parent_tool_use_id: null,
            session_id: "",
          },
        });
      }
      // Check queue
      if (queue.length > 0) {
        const msg = queue.shift()!;
        return Promise.resolve({
          done: false,
          value: {
            type: "user" as const,
            message: { role: "user" as const, content: msg },
            parent_tool_use_id: null,
            session_id: "",
          },
        });
      }
      if (done) return Promise.resolve({ done: true, value: undefined });
      // Wait for next push
      return new Promise((resolve) => {
        resolver = resolve;
      });
    },
    return(): Promise<IteratorResult<unknown, void>> {
      close();
      return Promise.resolve({ done: true, value: undefined });
    },
    throw(err?: unknown): Promise<IteratorResult<unknown, void>> {
      close();
      return Promise.reject(err);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    [Symbol.asyncDispose]() {
      close();
      return Promise.resolve();
    },
  };

  return { generator, push, close };
}

async function runSdkQuery(
  managed: ManagedSubprocess,
  options: SubprocessOptions,
): Promise<void> {
  const sdk = await getSdkClient();

  const cliInfo = discoverClaudeCli();
  if (!cliInfo) {
    throw new Error(
      "Claude CLI not found. Please install it or configure the path in Settings.",
    );
  }

  const language = resolveSetting("language", {}) ?? undefined;

  const queryOptions: Record<string, unknown> = {
    cwd: options.cwd,
    permissionMode: options.permissionMode ?? "acceptEdits",
    pathToClaudeCodeExecutable: cliInfo.path,
    model: options.model ?? DEFAULT_MODEL,
    settingSources: ["user", "project", "local"],
    includePartialMessages: true,
    ...(language && { language }),
  };

  if (options.systemPrompt) {
    queryOptions.systemPrompt = options.systemPrompt;
  }

  if (options.resumeSessionId) {
    queryOptions.resume = options.resumeSessionId;
    managed.resumingFromSessionId = options.resumeSessionId;
    console.log(`[subprocess-manager] Resuming session ${options.resumeSessionId} for ${managed.id}, model=${options.model}`);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    queryOptions.allowedTools = options.allowedTools;
  }

  if (options.mcpServers) {
    queryOptions.mcpServers = options.mcpServers;
  }

  if (managed.abortController) {
    queryOptions.abortController = managed.abortController;
  }

  // Add canUseTool callback to handle permissions, AskUserQuestion, and track file changes
  queryOptions.canUseTool = createCanUseToolHandler(managed);

  // Create a persistent message stream for multi-turn messaging
  const messageStream = createMessageStream(options.prompt);
  managed.pushMessage = messageStream.push;
  managed.closeMessageStream = messageStream.close;

  const queryObj = sdk.query({
    prompt: messageStream.generator,
    options: queryOptions,
  });

  managed.query = queryObj as import("@anthropic-ai/claude-agent-sdk").Query;

  const isResume = !!options.resumeSessionId;
  let messageCount = 0;

  try {
    for await (const message of queryObj) {
      messageCount++;
      if (managed.status === "stopped") break;
      handleSdkMessage(managed, message as Record<string, unknown>);
    }

    console.log(`[subprocess-manager] SDK query finished for ${managed.id}: status=${managed.status}, messages=${messageCount}, resume=${isResume}`);

    if (managed.status === "running") {
      managed.status = "completed";
      persistSessionStatus(managed.id, "completed", managed.sdkSessionId);
      flushNotifyDbUpdated(managed.id);
      for (const listener of managed.completionListeners) listener(0);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 0,
      });
    } else if (managed.status === "paused") {
      // Interrupted — broadcast paused event and call completion listeners with
      // exit code 2 (paused) so orchestrators (e.g. execute) can resolve their
      // Promise.allSettled and update their own status.
      flushNotifyDbUpdated(managed.id);
      for (const listener of managed.completionListeners) listener(2);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_paused",
      });
    } else if (managed.status === "stopped") {
      persistSessionStatus(managed.id, "completed", managed.sdkSessionId);
      flushNotifyDbUpdated(managed.id);
      for (const listener of managed.completionListeners) listener(1);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 1,
      });
    }
  } catch (err) {
    if (managed.status === "paused") {
      // Interrupt threw — still treat as paused
      flushNotifyDbUpdated(managed.id);
      for (const listener of managed.completionListeners) listener(2);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_paused",
      });
    } else if (managed.status === "stopped") {
      flushNotifyDbUpdated(managed.id);
      for (const listener of managed.completionListeners) listener(1);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 1,
      });
    } else {
      console.error(`[subprocess-manager] SDK query failed for ${managed.id}:`, err);
      // If this was a resume attempt that failed, restore the original claude_session_id
      // and keep status as 'paused' so the user can retry
      if (managed.resumingFromSessionId) {
        const sDbId = getSessionDbId(managed.id);
        if (sDbId) {
          try {
            const db = getDatabase();
            persistClaudeSessionId(sDbId, managed.resumingFromSessionId);
            transitionAgentSession(db, sDbId, "paused", undefined, { ended_at: new Date().toISOString(), subprocess_id: null });
            console.log(`[subprocess-manager] Restored session ${sDbId} to paused with original session ID ${managed.resumingFromSessionId}`);
          } catch (e) { console.warn("[subprocess-manager] best-effort op failed:", e); }
        }
      }
      managed.status = "error";
      flushNotifyDbUpdated(managed.id);
      // Persist error status to DB
      if (!managed.resumingFromSessionId) {
        persistSessionStatus(managed.id, "error");
      }
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorMessage = managed.resumingFromSessionId
        ? `Failed to resume session: ${rawMessage}. The session may have expired. You can try again or start a new session.`
        : rawMessage;
      // Persist error message to DB so it survives the stream buffer clear
      const errorSessionDbId = getSessionDbId(managed.id);
      if (errorSessionDbId) {
        persistStreamEvent(errorSessionDbId, {
          type: "error",
          error: { type: "sdk_error", message: errorMessage },
        } as StreamEvent);
      }
      broadcastEvent(managed.id, managed.agentType, {
        type: "error",
        error: {
          type: "sdk_error",
          message: errorMessage,
        },
      });
      for (const listener of managed.completionListeners) listener(1);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 1,
      });
    }
  } finally {
    if (managed.status !== "paused") {
      messageStream.close();
      // Clear in-memory background tasks for this subprocess
      clearBackgroundTasks(managed.id);
    }
  }
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
  if (managed.status === "paused" || managed.status === "completed") {
    if (!managed.sdkSessionId || !managed.originalOptions) {
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
      resumeSessionId: managed.sdkSessionId,
      model: freshModel,
    };
    // Re-run the SDK query with resume
    runSdkQuery(managed, resumeOptions).catch((err) => {
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
