import { getDatabase } from "../db/database";
import { discoverClaudeCli } from "./cli-discovery";
import { getSessionDbId, persistStreamEvent, persistClaudeSessionId, notifyDbUpdated } from "./ipc-bridge";
import { DEFAULT_MODEL } from "./models";
import { resolvePermission, appendToSettingsLocal, loadAllowedPatterns } from "./permissions";
import { broadcast, AGENT_EVENT_CHANNEL, ASK_USER_QUESTION_CHANNEL, ASK_USER_ANSWER_CHANNEL, TOOL_PERMISSION_CHANNEL } from "./broadcast";
import { getSdkClient, type SdkQuery } from "./sdk-client";
import type { AgentEvent, AgentType, StreamEvent } from "./types";
import EventEmitter from "node:events";

const MAX_CONCURRENT = 10;

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
  /** Claude model to use (defaults to DEFAULT_MODEL) */
  model?: string;
  /** Permission mode for the SDK query */
  permissionMode?: "acceptEdits" | "plan";
  /** Worktree path for permission resolution (auto-allow tools inside this directory) */
  worktreePath?: string;
}


export interface ManagedSubprocess {
  id: string;
  agentType: string;
  startedAt: Date;
  status: "running" | "stopped" | "error" | "completed" | "paused";
  /** Abort controller to cancel the SDK query */
  abortController?: AbortController;
  /** The SDK Query object for close/interrupt */
  query?: import("@anthropic-ai/claude-agent-sdk").Query;
  /** Push a user message into the streaming input generator */
  pushMessage?: (message: string) => void;
  /** Close the message stream (signals no more user messages) */
  closeMessageStream?: () => void;
  /** Event listeners registered by agent-specific code */
  eventListeners: Array<(event: StreamEvent) => void>;
  /** Completion listeners called when the query finishes */
  completionListeners: Array<(exitCode: number) => void | Promise<void>>;
  /** SDK session ID for resume after interrupt */
  sdkSessionId?: string;
  /** Original claude_session_id we're resuming from (to restore on failure) */
  resumingFromSessionId?: string;
  /** Original options used to start this subprocess (needed for resume) */
  originalOptions?: SubprocessOptions;
  /** Worktree path for permission resolution */
  worktreePath?: string;
  /** Session-scoped permission approvals (patterns already approved by user) */
  cachedPermissions: Set<string>;
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
      const msgId = sessionDbId ? persistStreamEvent(sessionDbId, innerEvent, parentToolUseId) : null;
      broadcastEvent(id, agentType, innerEvent, parentToolUseId, msgId);
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
        } catch { /* best-effort */ }

        // Broadcast usage to renderer for live updates
        broadcastEvent(id, agentType, {
          type: "system",
          subtype: "usage_update",
          input_tokens: totalInput,
          output_tokens: totalOutput,
        } as StreamEvent);
      }
    }
    if (message) {
      const content = message.content as
        | Array<Record<string, unknown>>
        | undefined;
      if (content) {
        for (let i = 0; i < content.length; i++) {
          const block = content[i];
          if (block.type === "text") {
            const event: StreamEvent = {
              type: "content_block_start",
              index: i,
              content_block: { type: "text", text: block.text as string },
            };
            const msgId = sessionDbId ? persistStreamEvent(sessionDbId, event, parentToolUseId) : null;
            broadcastEvent(id, agentType, event, parentToolUseId, msgId);
            for (const listener of managed.eventListeners) listener(event);
          } else if (block.type === "tool_use") {
            const toolName = block.name as string;
            const toolInput = block.input as Record<string, unknown>;

            // Detect EnterPlanMode tool call — update DB so UI reflects plan mode.
            // We catch it here in the message stream to ensure the DB always
            // reflects plan mode, regardless of how the SDK handles the tool.
            if (toolName === "EnterPlanMode" && sessionDbId) {
              try {
                const db2 = getDatabase();
                db2.prepare("UPDATE agent_sessions SET permission_mode = 'plan' WHERE id = ?").run(sessionDbId);
                const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sessionDbId) as { feature_id: number } | undefined;
                if (row) notifyDbUpdated("agent_session", row.feature_id);
              } catch { /* best-effort */ }
            }

            const event: StreamEvent = {
              type: "content_block_start",
              index: i,
              content_block: {
                type: "tool_use",
                id: block.id as string,
                name: toolName,
                input: toolInput,
              },
            };
            const msgId = sessionDbId ? persistStreamEvent(sessionDbId, event, parentToolUseId) : null;
            broadcastEvent(id, agentType, event, parentToolUseId, msgId);
            for (const listener of managed.eventListeners) listener(event);

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
            const msgId = sessionDbId ? persistStreamEvent(sessionDbId, toolResultEvent, parentToolUseId) : null;
            broadcastEvent(id, agentType, toolResultEvent, parentToolUseId, msgId);
          }
        }
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
      const msgId = sessionDbId ? persistStreamEvent(sessionDbId, toolResultEvent, parentToolUseId) : null;
      broadcastEvent(id, agentType, toolResultEvent, parentToolUseId, msgId);
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
    // Track compaction events
    const subtype = (msg.subtype as string) ?? "unknown";
    if (subtype === "compact_boundary" && sessionDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET was_compacted = 1 WHERE id = ?").run(sessionDbId);
      } catch { /* best-effort */ }
    }
    broadcastEvent(
      id,
      agentType,
      {
        type: "system",
        subtype,
        session_id: msg.session_id as string | undefined,
        pre_tokens: msg.pre_tokens as number | undefined,
        compact_metadata: msg.compact_metadata as { trigger: string; pre_tokens: number } | undefined,
      },
      parentToolUseId,
    );
  }
}

/**
 * Start a new Claude Agent SDK query.
 */
export function startSubprocess(options: SubprocessOptions): ManagedSubprocess {
  if (activeProcesses.size >= MAX_CONCURRENT) {
    throw new Error(
      `Maximum concurrent agent limit reached (${MAX_CONCURRENT})`,
    );
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
function createMessageStream(initialPrompt: string) {
  // Queue of pending messages and a resolver for the current wait
  const queue: string[] = [];
  let resolver: ((value: IteratorResult<unknown, void>) => void) | null = null;
  let done = false;

  function push(message: string) {
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
            message: { role: "user" as const, content: prompt },
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

  const queryOptions: Record<string, unknown> = {
    cwd: options.cwd,
    permissionMode: options.permissionMode ?? "acceptEdits",
    pathToClaudeCodeExecutable: cliInfo.path,
    model: options.model ?? DEFAULT_MODEL,
    settingSources: ["user", "project", "local"],
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

  if (managed.abortController) {
    queryOptions.abortController = managed.abortController;
  }

  // Add canUseTool callback to handle permissions, AskUserQuestion, and track file changes
  queryOptions.canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ) => {
    // --- Smart permission resolution ---
    // Before handling special tools (AskUserQuestion, ExitPlanMode), check
    // whether this tool call should be auto-allowed, denied, or prompted.
    if (managed.worktreePath && toolName !== "AskUserQuestion" && toolName !== "ExitPlanMode") {
      const permResult = resolvePermission(
        toolName,
        input,
        managed.worktreePath,
        managed.cachedPermissions,
      );

      if (permResult === "allow") {
        return { behavior: "allow" as const, updatedInput: input };
      }

      if ("denied" in permResult) {
        return {
          behavior: "deny" as const,
          message: permResult.reason,
        };
      }

      // needs_prompt — ask the user
      if ("needs_prompt" in permResult) {
        try {
          const decision = await requestToolPermission(managed.id, {
            toolName,
            input,
            description: permResult.description,
            pattern: permResult.pattern,
          });

          if (decision.decision === "allow_once") {
            managed.cachedPermissions.add(permResult.pattern);
            return { behavior: "allow" as const, updatedInput: input };
          }

          if (decision.decision === "allow_future") {
            managed.cachedPermissions.add(permResult.pattern);
            // Persist to settings.local.json so the SDK auto-allows next time
            try {
              appendToSettingsLocal(managed.worktreePath!, permResult.pattern);
            } catch (err) {
              console.error("[subprocess-manager] Failed to write settings.local.json:", err);
            }
            return { behavior: "allow" as const, updatedInput: input };
          }

          // deny
          return {
            behavior: "deny" as const,
            message: decision.feedback || "User denied this tool call.",
          };
        } catch (err) {
          console.error("[subprocess-manager] Permission prompt failed:", err);
          // On error, deny to be safe
          return {
            behavior: "deny" as const,
            message: "Permission prompt timed out or failed.",
          };
        }
      }
    }

    if (toolName === "AskUserQuestion") {
      // Persist questions to DB before broadcasting
      const sDbId = getSessionDbId(managed.id);
      let featureIdForNotify: number | null = null;
      if (sDbId) {
        try {
          const db2 = getDatabase();
          db2.prepare("UPDATE agent_sessions SET pending_questions = ? WHERE id = ?")
            .run(JSON.stringify(input), sDbId);
          const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
          if (row) {
            featureIdForNotify = row.feature_id;
            notifyDbUpdated("agent_session", row.feature_id);
          }
        } catch { /* best-effort */ }
      }

      try {
        // Request answers from the renderer
        const answers = await requestUserAnswers(managed.id, input);

        // Clear pending_questions on answer
        if (sDbId) {
          try {
            const db2 = getDatabase();
            db2.prepare("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?").run(sDbId);
            if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
          } catch { /* best-effort */ }
        }

        // Return the answers in the format expected by Claude
        return {
          behavior: "allow" as const,
          updatedInput: {
            ...input,
            answers,
          },
        };
      } catch (error) {
        console.error(
          "[subprocess-manager] Failed to get user answers:",
          error,
        );
        // Clear pending_questions on error too
        if (sDbId) {
          try {
            const db2 = getDatabase();
            db2.prepare("UPDATE agent_sessions SET pending_questions = NULL WHERE id = ?").run(sDbId);
            if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
          } catch { /* best-effort */ }
        }
        return {
          behavior: "allow" as const,
          updatedInput: {
            ...input,
            answers: {},
          },
        };
      }
    }

    if (toolName === "ExitPlanMode") {
      // Persist pending plan approval to DB + notify renderer
      const sDbId = getSessionDbId(managed.id);
      let featureIdForNotify: number | null = null;
      if (sDbId) {
        try {
          const db2 = getDatabase();
          db2.prepare("UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?")
            .run(JSON.stringify(input), sDbId);
          const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
          if (row) {
            featureIdForNotify = row.feature_id;
            notifyDbUpdated("agent_session", row.feature_id);
          }
        } catch { /* best-effort */ }
      }

      try {
        // Wait for user approval via questionEmitter
        const result = await new Promise<{ approved: boolean; feedback?: string }>((resolve, reject) => {
          const timeout = setTimeout(
            () => {
              questionEmitter.removeAllListeners(`plan-approval:${managed.id}`);
              reject(new Error("Plan approval timeout (15m)"));
            },
            15 * 60 * 1000,
          );

          questionEmitter.once(
            `plan-approval:${managed.id}`,
            (response: { approved: boolean; feedback?: string }) => {
              clearTimeout(timeout);
              resolve(response);
            },
          );
        });

        if (result.approved) {
          // Switch permission mode to acceptEdits so Claude starts executing
          // (smart canUseTool callback handles fine-grained permissions)
          if (managed.query) {
            await managed.query.setPermissionMode("acceptEdits");
          }
          // Update DB: permission_mode = 'acceptEdits', clear pending_plan_approval
          if (sDbId) {
            try {
              const db2 = getDatabase();
              db2.prepare("UPDATE agent_sessions SET permission_mode = 'acceptEdits', pending_plan_approval = NULL WHERE id = ?")
                .run(sDbId);
              if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
            } catch { /* best-effort */ }
          }
          return { behavior: "allow" as const, updatedInput: input };
        } else {
          // User requested changes — clear pending_plan_approval and deny with feedback
          if (sDbId) {
            try {
              const db2 = getDatabase();
              db2.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(sDbId);
              if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
            } catch { /* best-effort */ }
          }
          return {
            behavior: "deny" as const,
            message: result.feedback || "User requested changes to the plan.",
          };
        }
      } catch (error) {
        // Timeout or error — clear pending_plan_approval
        if (sDbId) {
          try {
            const db2 = getDatabase();
            db2.prepare("UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?").run(sDbId);
            if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
          } catch { /* best-effort */ }
        }
        console.error("[subprocess-manager] Plan approval failed:", error);
        return { behavior: "allow" as const, updatedInput: input };
      }
    }

    // Allow all other tools
    return { behavior: "allow" as const, updatedInput: input };
  };

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
      for (const listener of managed.completionListeners) listener(0);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 0,
      });
    } else if (managed.status === "paused") {
      // Interrupted — broadcast paused event and call completion listeners with
      // exit code 2 (paused) so orchestrators (e.g. execute) can resolve their
      // Promise.allSettled and update their own status.
      for (const listener of managed.completionListeners) listener(2);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_paused",
      });
    } else if (managed.status === "stopped") {
      for (const listener of managed.completionListeners) listener(1);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_done",
        exitCode: 1,
      });
    }
  } catch (err) {
    if (managed.status === "paused") {
      // Interrupt threw — still treat as paused
      for (const listener of managed.completionListeners) listener(2);
      broadcastEvent(managed.id, managed.agentType, {
        type: "agent_paused",
      });
    } else if (managed.status === "stopped") {
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
            db.prepare("UPDATE agent_sessions SET status = 'paused', ended_at = datetime('now'), subprocess_id = NULL WHERE id = ?").run(sDbId);
            console.log(`[subprocess-manager] Restored session ${sDbId} to paused with original session ID ${managed.resumingFromSessionId}`);
          } catch { /* best-effort */ }
        }
      }
      managed.status = "error";
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
export function sendMessageToSubprocess(id: string, message: string): SendMessageResult {
  const managed = activeProcesses.get(id);
  if (!managed) return { success: false, reason: "no_process" };

  if (managed.status !== "running" && managed.status !== "paused" && managed.status !== "completed") {
    return { success: false, reason: "invalid_status" };
  }

  // Persist the user message to the database and broadcast to renderer
  const sessionDbId = getSessionDbId(id);
  if (sessionDbId) {
    try {
      const db = getDatabase();
      const result = db.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
      ).run(sessionDbId, "user", message, "user_message", null);
      const msgDbId = Number(result.lastInsertRowid);
      broadcastEvent(id, managed.agentType, { type: "user_message", content: message }, null, msgDbId);
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
      db.prepare("UPDATE agent_sessions SET status = 'running', ended_at = NULL WHERE id = ?").run(resumeDbId);
    }
    // Fresh abort controller for the resumed query
    managed.abortController = new AbortController();
    const resumeOptions: SubprocessOptions = {
      ...managed.originalOptions,
      prompt: message,
      resumeSessionId: managed.sdkSessionId,
    };
    // Re-run the SDK query with resume
    runSdkQuery(managed, resumeOptions).catch((err) => {
      console.error(`[subprocess-manager] Resume SDK query failed for ${id}:`, err);
    });
    return { success: true, reason: "resumed" };
  }

  if (!managed.pushMessage) return { success: false, reason: "no_push" };
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
    db.prepare("UPDATE agent_sessions SET status = 'paused', ended_at = datetime('now'), subprocess_id = NULL WHERE id = ?").run(sessionDbId);
    if (managed.sdkSessionId) persistClaudeSessionId(sessionDbId, managed.sdkSessionId);
  }

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

/**
 * Request user answers to AskUserQuestion from the renderer.
 * Sends a question request to all renderer windows and waits for a response.
 */
async function requestUserAnswers(
  subprocessId: string,
  questions: Record<string, unknown>,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        questionEmitter.removeAllListeners(`answer:${subprocessId}`);
        reject(new Error("User answer timeout (15m)"));
      },
      15 * 60 * 1000,
    ); // 15 minute timeout

    // Listen for answer from renderer
    questionEmitter.once(
      `answer:${subprocessId}`,
      (answers: Record<string, string>) => {
        clearTimeout(timeout);
        resolve(answers);
      },
    );

    // Broadcast question request to all renderer windows
    broadcast(ASK_USER_QUESTION_CHANNEL, { subprocessId, questions });
  });
}

/**
 * Request permission from the user for a tool call.
 * Mirrors the pattern of `requestUserAnswers()` — broadcasts via IPC and waits
 * for the renderer to emit a response on `questionEmitter`.
 */
async function requestToolPermission(
  subprocessId: string,
  permissionRequest: {
    toolName: string;
    input: Record<string, unknown>;
    description: string;
    pattern: string;
  },
): Promise<{ decision: "allow_once" | "allow_future" | "deny"; feedback?: string }> {
  // Persist pending permission to DB before broadcasting
  const sDbId = getSessionDbId(subprocessId);
  let featureIdForNotify: number | null = null;
  if (sDbId) {
    try {
      const db2 = getDatabase();
      db2.prepare("UPDATE agent_sessions SET pending_permission = ? WHERE id = ?")
        .run(JSON.stringify(permissionRequest), sDbId);
      const row = db2.prepare("SELECT feature_id FROM agent_sessions WHERE id = ?").get(sDbId) as { feature_id: number } | undefined;
      if (row) {
        featureIdForNotify = row.feature_id;
        notifyDbUpdated("agent_session", row.feature_id);
      }
    } catch { /* best-effort */ }
  }

  try {
    const result = await new Promise<{ decision: "allow_once" | "allow_future" | "deny"; feedback?: string }>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          questionEmitter.removeAllListeners(`permission:${subprocessId}`);
          reject(new Error("Tool permission timeout (15m)"));
        },
        15 * 60 * 1000,
      );

      questionEmitter.once(
        `permission:${subprocessId}`,
        (response: { decision: "allow_once" | "allow_future" | "deny"; feedback?: string }) => {
          clearTimeout(timeout);
          resolve(response);
        },
      );

      // Broadcast permission request to all renderer windows
      broadcast(TOOL_PERMISSION_CHANNEL, { subprocessId, ...permissionRequest });
    });

    // Clear pending_permission on response
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_permission = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch { /* best-effort */ }
    }

    return result;
  } catch (error) {
    // Clear pending_permission on error
    if (sDbId) {
      try {
        const db2 = getDatabase();
        db2.prepare("UPDATE agent_sessions SET pending_permission = NULL WHERE id = ?").run(sDbId);
        if (featureIdForNotify) notifyDbUpdated("agent_session", featureIdForNotify);
      } catch { /* best-effort */ }
    }
    throw error;
  }
}

/**
 * Submit a tool permission decision from the renderer.
 * Called via tRPC when the user responds to a permission prompt.
 */
export function submitToolPermission(
  subprocessId: string,
  decision: "allow_once" | "allow_future" | "deny",
  feedback?: string,
): void {
  questionEmitter.emit(`permission:${subprocessId}`, { decision, feedback });
}

/**
 * Submit user answers for a pending AskUserQuestion.
 * Called from the renderer via IPC when the user submits their answers.
 */
export function submitUserAnswers(
  subprocessId: string,
  answers: Record<string, string>,
): void {
  // Persist the user's answers as a visible user message in the session
  const sessionDbId = getSessionDbId(subprocessId);
  if (sessionDbId) {
    try {
      const managed = activeProcesses.get(subprocessId);
      const lines = Object.entries(answers).map(([q, a]) => `**${q}**\n${a}`);
      const content = lines.join("\n\n");
      const db = getDatabase();
      const result = db.prepare(
        "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
      ).run(sessionDbId, "user", content, "user_message", null);
      const msgDbId = Number(result.lastInsertRowid);
      if (managed) {
        broadcastEvent(subprocessId, managed.agentType, { type: "user_message", content }, null, msgDbId);
      }
    } catch {
      // Best-effort persistence
    }
  }

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
 * Mark all running agent sessions as 'paused' in the database.
 * Called during app shutdown to preserve session state for resume.
 */
export function saveAllSessionStates(): void {
  try {
    const db = getDatabase();
    // Mark running sessions as paused and clear subprocess_id since the process is dead
    db.prepare(
      "UPDATE agent_sessions SET status = 'paused', ended_at = datetime('now'), subprocess_id = NULL WHERE status = 'running'",
    ).run();
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

/**
 * Submit a plan approval or rejection for a pending ExitPlanMode tool call.
 * Called from the renderer via tRPC when the user approves or requests changes.
 */
export function submitPlanApproval(
  subprocessId: string,
  approved: boolean,
  feedback?: string,
): void {
  // Persist the user's feedback as a visible user message in the session
  if (!approved && feedback) {
    const sessionDbId = getSessionDbId(subprocessId);
    if (sessionDbId) {
      try {
        const managed = activeProcesses.get(subprocessId);
        const content = `**Plan feedback:**\n${feedback}`;
        const db = getDatabase();
        const result = db.prepare(
          "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
        ).run(sessionDbId, "user", content, "user_message", null);
        const msgDbId = Number(result.lastInsertRowid);
        if (managed) {
          broadcastEvent(subprocessId, managed.agentType, { type: "user_message", content }, null, msgDbId);
        }
      } catch {
        // Best-effort persistence
      }
    }
  }

  questionEmitter.emit(`plan-approval:${subprocessId}`, { approved, feedback });
}

// ---------------------------------------------------------------------------
// Slash command discovery
// ---------------------------------------------------------------------------

interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

/** Cache for slash commands keyed by cwd — avoids re-spawning on every keystroke */
const commandsCache = new Map<string, { commands: SlashCommandInfo[]; timestamp: number }>();
const COMMANDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Track in-flight fetches to avoid duplicate temporary subprocesses */
const commandsFetching = new Map<string, Promise<SlashCommandInfo[]>>();

function mapCommands(commands: Array<{ name: string; description: string; argumentHint?: string }>): SlashCommandInfo[] {
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
  }));
}

/**
 * Get supported slash commands.
 * If a subprocess ID is provided and active, uses its Query object.
 * Otherwise spawns a temporary subprocess to fetch commands, then closes it.
 */
export async function getSupportedCommands(
  subprocessId: string | null,
  cwd: string,
): Promise<SlashCommandInfo[]> {
  // 1. Try existing subprocess first
  if (subprocessId) {
    const managed = activeProcesses.get(subprocessId);
    if (managed?.query && managed.status !== "stopped" && managed.status !== "error") {
      try {
        const result = mapCommands(await managed.query.supportedCommands());
        commandsCache.set(cwd, { commands: result, timestamp: Date.now() });
        return result;
      } catch (err) {
        console.error(`[subprocess-manager] getSupportedCommands error for subprocess ${subprocessId}:`, err);
      }
    }
  }

  // 2. Check cache
  const cached = commandsCache.get(cwd);
  if (cached && Date.now() - cached.timestamp < COMMANDS_CACHE_TTL) {
    return cached.commands;
  }

  // 3. Deduplicate in-flight fetches for this cwd
  const inflight = commandsFetching.get(cwd);
  if (inflight) return inflight;

  // 4. Spawn a temporary subprocess to fetch commands
  const fetchPromise = fetchCommandsViaTemporaryQuery(cwd);
  commandsFetching.set(cwd, fetchPromise);
  try {
    const result = await fetchPromise;
    commandsCache.set(cwd, { commands: result, timestamp: Date.now() });
    return result;
  } finally {
    commandsFetching.delete(cwd);
  }
}

/**
 * Spawn a short-lived SDK query solely to call supportedCommands(), then close it.
 */
async function fetchCommandsViaTemporaryQuery(cwd: string): Promise<SlashCommandInfo[]> {
  const sdk = await getSdkClient();

  const cliInfo = discoverClaudeCli();
  if (!cliInfo) return [];

  // Async iterable that never yields — keeps the subprocess alive until close()
  const neverYield: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<unknown>>(() => {}) };
    },
  };

  let queryObj: SdkQuery | null = null;
  try {
    queryObj = sdk.query({
      prompt: neverYield,
      options: { cwd, permissionMode: "acceptEdits", pathToClaudeCodeExecutable: cliInfo.path },
    });
    return mapCommands(await queryObj.supportedCommands() as SlashCommandInfo[]);
  } catch (err) {
    console.error("[subprocess-manager] fetchCommandsViaTemporaryQuery error:", err);
    return [];
  } finally {
    try { queryObj?.close(); } catch { /* already closed */ }
  }
}

// Re-export channel constants for use in preload and main
export { ASK_USER_QUESTION_CHANNEL, ASK_USER_ANSWER_CHANNEL, TOOL_PERMISSION_CHANNEL } from "./broadcast";
