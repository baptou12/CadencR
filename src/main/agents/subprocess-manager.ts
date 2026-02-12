import { BrowserWindow } from "electron";
import { getDatabase } from "../db/database";
import { discoverClaudeCli } from "./cli-discovery";
import type { AgentEvent, AgentType, StreamEvent } from "./types";

const MAX_CONCURRENT = 10;
const AGENT_EVENT_CHANNEL = "agent:event";

export interface SubprocessOptions {
  /** Working directory for the Claude CLI process */
  cwd: string;
  /** Agent type identifier */
  agentType: string;
  /** System prompt to pass to Claude */
  systemPrompt?: string;
  /** Initial user message / prompt */
  prompt: string;
  /** Session ID for resuming a previous session */
  resumeSessionId?: string;
  /** Allowed tools configuration */
  allowedTools?: string[];
}

export interface ManagedSubprocess {
  id: string;
  agentType: string;
  startedAt: Date;
  status: "running" | "stopped" | "error" | "completed";
  /** Abort controller to cancel the SDK query */
  abortController?: AbortController;
  /** The async iterator (kept for reference) */
  queryIterator?: AsyncGenerator<unknown, void>;
  /** Event listeners registered by agent-specific code */
  eventListeners: Array<(event: StreamEvent) => void>;
  /** Completion listeners called when the query finishes */
  completionListeners: Array<(exitCode: number) => void>;
}

const activeProcesses = new Map<string, ManagedSubprocess>();

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `agent-${Date.now()}-${idCounter}`;
}

/**
 * Broadcast a stream event to all renderer windows.
 */
function broadcastEvent(id: string, agentType: AgentType | string, event: StreamEvent): void {
  const agentEvent: AgentEvent = {
    subprocessId: id,
    agentType: agentType as AgentType,
    event,
    timestamp: Date.now(),
  };

  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(AGENT_EVENT_CHANNEL, agentEvent);
    }
  }
}

/**
 * Convert an SDK message to StreamEvent(s) and broadcast them.
 */
function handleSdkMessage(managed: ManagedSubprocess, msg: Record<string, unknown>): void {
  const { id, agentType } = managed;
  const type = msg.type as string;

  console.log("[subprocess-manager] SDK message type:", type);

  if (type === "stream_event") {
    // SDKPartialAssistantMessage — contains the granular content_block_start/delta/stop events
    const innerEvent = msg.event as StreamEvent;
    if (innerEvent) {
      broadcastEvent(id, agentType, innerEvent);
      for (const listener of managed.eventListeners) listener(innerEvent);
    }
  } else if (type === "assistant") {
    // Full assistant message — extract text and tool_use content blocks
    const message = msg.message as Record<string, unknown> | undefined;
    if (message) {
      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (let i = 0; i < content.length; i++) {
          const block = content[i];
          if (block.type === "text") {
            broadcastEvent(id, agentType, {
              type: "content_block_start",
              index: i,
              content_block: { type: "text", text: block.text as string },
            });
          } else if (block.type === "tool_use") {
            broadcastEvent(id, agentType, {
              type: "content_block_start",
              index: i,
              content_block: {
                type: "tool_use",
                id: block.id as string,
                name: block.name as string,
                input: block.input as Record<string, unknown>,
              },
            });
          }
        }
      }
    }
  } else if (type === "tool_result" || type === "result") {
    // Tool result or final result
    if (type === "tool_result") {
      broadcastEvent(id, agentType, {
        type: "tool_result",
        tool_use_id: (msg.tool_use_id as string) ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        is_error: (msg.is_error as boolean) ?? false,
      });
    } else {
      broadcastEvent(id, agentType, {
        type: "result",
        result: msg.result as string | undefined,
      });
    }
  } else if (type === "system") {
    broadcastEvent(id, agentType, {
      type: "system",
      subtype: (msg.subtype as string) ?? "unknown",
      session_id: msg.session_id as string | undefined,
    });
  }
}

/**
 * Start a new Claude Agent SDK query.
 */
export function startSubprocess(options: SubprocessOptions): ManagedSubprocess {
  if (activeProcesses.size >= MAX_CONCURRENT) {
    throw new Error(`Maximum concurrent agent limit reached (${MAX_CONCURRENT})`);
  }

  const id = generateId();
  const abortController = new AbortController();

  const managed: ManagedSubprocess = {
    id,
    agentType: options.agentType,
    startedAt: new Date(),
    status: "running",
    abortController,
    eventListeners: [],
    completionListeners: [],
  };

  activeProcesses.set(id, managed);

  // Start the SDK query asynchronously
  runSdkQuery(managed, options).catch((err) => {
    console.error("[subprocess-manager] SDK query error:", err);
    managed.status = "error";
    broadcastEvent(id, options.agentType, {
      type: "error",
      error: { type: "sdk_error", message: err instanceof Error ? err.message : String(err) },
    });
  });

  console.log("[subprocess-manager] started SDK query, id:", id);

  return managed;
}

async function runSdkQuery(managed: ManagedSubprocess, options: SubprocessOptions): Promise<void> {
  // Dynamic import since the SDK is ESM
  const { query } = await import("@anthropic-ai/claude-agent-sdk") as {
    query: (opts: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => AsyncGenerator<Record<string, unknown>, void>;
  };

  const cliInfo = discoverClaudeCli();
  if (!cliInfo) {
    throw new Error("Claude CLI not found. Please install it or configure the path in Settings.");
  }

  const queryOptions: Record<string, unknown> = {
    cwd: options.cwd,
    permissionMode: "bypassPermissions" as const,
    pathToClaudeCodeExecutable: cliInfo.path,
  };

  if (options.systemPrompt) {
    queryOptions.systemPrompt = options.systemPrompt;
  }

  if (options.resumeSessionId) {
    queryOptions.resume = options.resumeSessionId;
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    queryOptions.allowedTools = options.allowedTools;
  }

  console.log("[subprocess-manager] calling SDK query() with cwd:", options.cwd);

  const iterator = query({
    prompt: options.prompt,
    options: queryOptions,
  });

  managed.queryIterator = iterator;

  try {
    for await (const message of iterator) {
      if (managed.status === "stopped") break;
      handleSdkMessage(managed, message as Record<string, unknown>);
    }

    if (managed.status === "running") {
      managed.status = "completed";
    }

    // Notify completion listeners
    for (const listener of managed.completionListeners) listener(0);

    // Broadcast agent_done
    broadcastEvent(managed.id, managed.agentType, {
      type: "agent_done",
      exitCode: 0,
    });
  } catch (err) {
    if (managed.status !== "stopped") {
      managed.status = "error";
      broadcastEvent(managed.id, managed.agentType, {
        type: "error",
        error: {
          type: "sdk_error",
          message: err instanceof Error ? err.message : String(err),
        },
      });
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 1,
      });
    }
  }
}

/**
 * Kill a running subprocess by ID.
 */
export function killSubprocess(id: string): boolean {
  const managed = activeProcesses.get(id);
  if (!managed || managed.status !== "running") {
    return false;
  }

  managed.status = "stopped";
  managed.abortController?.abort();
  return true;
}

/**
 * Get a managed subprocess by ID.
 */
export function getSubprocess(id: string): ManagedSubprocess | undefined {
  return activeProcesses.get(id);
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

/**
 * Remove completed/stopped/errored subprocesses from tracking.
 */
export function cleanupSubprocesses(): void {
  for (const [id, managed] of activeProcesses) {
    if (managed.status !== "running") {
      activeProcesses.delete(id);
    }
  }
}

/**
 * Send input to a running subprocess via stdin.
 * Note: With SDK approach, this is not directly supported.
 * For interactive input, use the SDK's streaming input mode.
 */
export function sendSubprocessInput(id: string, _input: string): boolean {
  const managed = activeProcesses.get(id);
  if (!managed || managed.status !== "running") {
    return false;
  }
  // TODO: Implement via SDK streaming input
  console.warn("[subprocess-manager] sendSubprocessInput not yet implemented for SDK mode");
  return false;
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
 * Mark all running agent sessions as 'interrupted' in the database.
 * Called during app shutdown to preserve session state for resume.
 */
export function saveAllSessionStates(): void {
  try {
    const db = getDatabase();
    db.prepare(
      "UPDATE agent_sessions SET status = 'interrupted', ended_at = datetime('now') WHERE status = 'running'",
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
