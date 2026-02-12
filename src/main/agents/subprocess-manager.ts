import { BrowserWindow } from "electron";
import { getDatabase } from "../db/database";
import { discoverClaudeCli } from "./cli-discovery";
import { getSessionDbId, persistStreamEvent } from "./ipc-bridge";
import type { AgentEvent, AgentType, StreamEvent } from "./types";
import EventEmitter from "node:events";

const MAX_CONCURRENT = 10;
const AGENT_EVENT_CHANNEL = "agent:event";
const ASK_USER_QUESTION_CHANNEL = "agent:ask-user-question";
const ASK_USER_ANSWER_CHANNEL = "agent:ask-user-answer";

// Global event emitter for question/answer coordination
const questionEmitter = new EventEmitter();

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
  /** The SDK Query object for streamInput/close */
  query?: import("@anthropic-ai/claude-agent-sdk").Query;
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
function broadcastEvent(id: string, agentType: AgentType | string, event: StreamEvent, parentToolUseId?: string | null): void {
  const agentEvent: AgentEvent = {
    subprocessId: id,
    agentType: agentType as AgentType,
    event,
    timestamp: Date.now(),
    parentToolUseId: parentToolUseId ?? undefined,
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
  const parentToolUseId = (msg.parent_tool_use_id as string | null | undefined) ?? null;

  console.log("[subprocess-manager] SDK message type:", type, parentToolUseId ? `(parent: ${parentToolUseId})` : "");

  // Persist events to agent_messages table
  const sessionDbId = getSessionDbId(id);

  if (type === "stream_event") {
    // SDKPartialAssistantMessage — contains the granular content_block_start/delta/stop events
    const innerEvent = msg.event as StreamEvent;
    if (innerEvent) {
      broadcastEvent(id, agentType, innerEvent, parentToolUseId);
      if (sessionDbId) persistStreamEvent(sessionDbId, innerEvent);
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
            const event: StreamEvent = {
              type: "content_block_start",
              index: i,
              content_block: { type: "text", text: block.text as string },
            };
            broadcastEvent(id, agentType, event, parentToolUseId);
            if (sessionDbId) persistStreamEvent(sessionDbId, event);
            for (const listener of managed.eventListeners) listener(event);
          } else if (block.type === "tool_use") {
            const event: StreamEvent = {
              type: "content_block_start",
              index: i,
              content_block: {
                type: "tool_use",
                id: block.id as string,
                name: block.name as string,
                input: block.input as Record<string, unknown>,
              },
            };
            broadcastEvent(id, agentType, event, parentToolUseId);
            if (sessionDbId) persistStreamEvent(sessionDbId, event);
            for (const listener of managed.eventListeners) listener(event);
          }
        }
      }
    }
  } else if (type === "tool_result" || type === "result") {
    // Tool result or final result
    if (type === "tool_result") {
      const toolResultEvent: StreamEvent = {
        type: "tool_result",
        tool_use_id: (msg.tool_use_id as string) ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        is_error: (msg.is_error as boolean) ?? false,
      };
      broadcastEvent(id, agentType, toolResultEvent, parentToolUseId);
      if (sessionDbId) persistStreamEvent(sessionDbId, toolResultEvent);
    } else {
      broadcastEvent(id, agentType, {
        type: "result",
        result: msg.result as string | undefined,
      }, parentToolUseId);
    }
  } else if (type === "system") {
    broadcastEvent(id, agentType, {
      type: "system",
      subtype: (msg.subtype as string) ?? "unknown",
      session_id: msg.session_id as string | undefined,
    }, parentToolUseId);
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
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  const { query } = sdk as {
    query: (opts: {
      prompt: string;
      options?: Record<string, unknown>;
    }) => import("@anthropic-ai/claude-agent-sdk").Query;
  };

  const cliInfo = discoverClaudeCli();
  if (!cliInfo) {
    throw new Error("Claude CLI not found. Please install it or configure the path in Settings.");
  }

  const queryOptions: Record<string, unknown> = {
    cwd: options.cwd,
    permissionMode: "bypassPermissions" as const,
    pathToClaudeCodeExecutable: cliInfo.path,
    model: "claude-haiku-4-5-20251001",
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

  if (managed.abortController) {
    queryOptions.abortController = managed.abortController;
  }

  // Add canUseTool callback to handle AskUserQuestion
  queryOptions.canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    if (toolName === "AskUserQuestion") {
      console.log("[subprocess-manager] AskUserQuestion intercepted");

      try {
        // Request answers from the renderer
        const answers = await requestUserAnswers(managed.id, input);

        // Return the answers in the format expected by Claude
        return {
          behavior: "allow" as const,
          updatedInput: {
            ...input,
            answers,
          },
        };
      } catch (error) {
        console.error("[subprocess-manager] Failed to get user answers:", error);
        // Return empty answers on error
        return {
          behavior: "allow" as const,
          updatedInput: {
            ...input,
            answers: {},
          },
        };
      }
    }

    // Allow all other tools
    return { behavior: "allow" as const, updatedInput: input };
  };

  console.log("[subprocess-manager] calling SDK query() with cwd:", options.cwd);

  const queryObj = query({
    prompt: options.prompt,
    options: queryOptions,
  });

  managed.query = queryObj;
  managed.queryIterator = queryObj;

  try {
    for await (const message of queryObj) {
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
 * Send a user message to a running subprocess via SDK streamInput.
 */
export async function sendMessageToSubprocess(id: string, message: string): Promise<boolean> {
  const managed = activeProcesses.get(id);
  if (!managed || managed.status !== "running" || !managed.query) {
    return false;
  }

  const userMessage = {
    type: "user" as const,
    message: { role: "user" as const, content: message },
    parent_tool_use_id: null,
    session_id: "",
  };

  // streamInput expects an AsyncIterable that yields one message
  async function* singleMessage() {
    yield userMessage;
  }

  await managed.query.streamInput(singleMessage());
  return true;
}

/**
 * Stop a running subprocess cleanly via SDK Query.close().
 */
export function stopSubprocess(id: string): boolean {
  const managed = activeProcesses.get(id);
  if (!managed || managed.status !== "running") {
    return false;
  }

  managed.status = "stopped";
  if (managed.query) {
    managed.query.close();
  } else {
    managed.abortController?.abort();
  }
  return true;
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
 * Request user answers to AskUserQuestion from the renderer.
 * Sends a question request to all renderer windows and waits for a response.
 */
async function requestUserAnswers(
  subprocessId: string,
  questions: Record<string, unknown>,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      questionEmitter.removeAllListeners(`answer:${subprocessId}`);
      reject(new Error("User answer timeout (15m)"));
    }, 15 * 60 * 1000); // 15 minute timeout

    // Listen for answer from renderer
    questionEmitter.once(`answer:${subprocessId}`, (answers: Record<string, string>) => {
      clearTimeout(timeout);
      resolve(answers);
    });

    // Broadcast question request to all renderer windows
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(ASK_USER_QUESTION_CHANNEL, {
          subprocessId,
          questions,
        });
      }
    }
  });
}

/**
 * Submit user answers for a pending AskUserQuestion.
 * Called from the renderer via IPC when the user submits their answers.
 */
export function submitUserAnswers(subprocessId: string, answers: Record<string, string>): void {
  console.log("[subprocess-manager] submitUserAnswers called for:", subprocessId);
  questionEmitter.emit(`answer:${subprocessId}`, answers);
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

// Export channel constants for use in preload and main
export { ASK_USER_QUESTION_CHANNEL, ASK_USER_ANSWER_CHANNEL };
