/**
 * SdkQueryRunner Effect Service
 *
 * Encapsulates the full Claude Agent SDK query lifecycle:
 *  - SDK client initialization and CLI discovery
 *  - Query options construction
 *  - Message stream creation (multi-turn messaging)
 *  - The for-await message loop and per-message routing
 *  - Delegating to CompletionActions on completion/pause/stop/error
 *  - Finally-block cleanup
 *
 * Extracted from runSdkQuery() and handleSdkMessage() in subprocess-manager.ts.
 */

import { Context, Effect, Layer } from "effect";
import { SessionPersistence } from "./SessionPersistence.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import { Database } from "./Database.js";
import { CompletionActions } from "./CompletionActions.js";
import { BackgroundTaskRegistry } from "./BackgroundTaskRegistry.js";
import { SdkError } from "../errors.js";
import { getSdkClient } from "../../agents/sdk-client.js";
import { discoverClaudeCli } from "../../agents/cli-discovery.js";
import { DEFAULT_MODEL, resolveModel } from "../../agents/models.js";
import { resolveSetting } from "../../db/settings.js";
import { createCanUseToolHandler } from "../../agents/tool-permissions.js";
import type {
  ManagedSubprocess,
  SubprocessOptions,
  AgentType,
  StreamEvent,
} from "../../agents/types.js";

export { SdkError } from "../errors.js";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SdkQueryRunnerService {
  /** Execute an SDK query for the given managed subprocess. Handles the full
   * lifecycle including message routing and completion/error delegation. */
  execute: (
    managed: ManagedSubprocess,
    options: SubprocessOptions,
  ) => Effect.Effect<void, SdkError>;
}

/** Context tag for the SdkQueryRunner service */
export class SdkQueryRunner extends Context.Tag("SdkQueryRunner")<
  SdkQueryRunner,
  SdkQueryRunnerService
>() {}

// ---------------------------------------------------------------------------
// Pure helper: message stream factory (no side effects)
// ---------------------------------------------------------------------------

type MessageContent = ManagedSubprocess["originalOptions"] extends { prompt: infer P } ? P : unknown;

/**
 * Creates an async generator that yields user messages on demand.
 * The initial prompt is yielded immediately; subsequent messages
 * are pushed via the returned `push` function.
 */
function createMessageStream(initialPrompt: MessageContent) {
  const queue: MessageContent[] = [];
  let resolver: ((value: IteratorResult<unknown, void>) => void) | null = null;
  let done = false;
  let firstPrompt: MessageContent = initialPrompt;

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
      if (firstPrompt) {
        const prompt = firstPrompt;
        firstPrompt = "" as MessageContent;
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

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

/**
 * ARCHITECTURAL CONSTRAINT:
 * All service methods used inside the synchronous message-handler helpers
 * (handleSdkMessage, handleStreamEvent, handleAssistant, handleUser,
 * handleToolOrResult, handleSystem, getFeatureId) MUST remain synchronous
 * (Effect.succeed-based) to be compatible with Effect.runSync.
 *
 * These helpers are called in a tight for-await stream loop where we do NOT
 * want to introduce async scheduling between individual message events.
 * If a method needs to become async (e.g. returns a Promise or uses
 * Effect.tryPromise), the calling code here must be updated to:
 *   1. Make all handler functions async
 *   2. Change the for-await loop to `await handleSdkMessage(...)`
 *   3. Use Effect.runPromise instead of Effect.runSync in those handlers
 *
 * The completion-handler calls (onCompleted / onPaused / onStopped / onError)
 * and the initial sessionDbId lookup are exempt from this constraint — they
 * already use Effect.runPromise and are called outside the tight loop.
 */
export const SdkQueryRunnerLive = Layer.effect(
  SdkQueryRunner,
  Effect.gen(function* () {
    const sp = yield* SessionPersistence;
    const eb = yield* EventBroadcaster;
    const database = yield* Database;
    const completion = yield* CompletionActions;
    const bgTasks = yield* BackgroundTaskRegistry;

    // -------------------------------------------------------------------------
    // Private: resolve featureId for a managed subprocess (used for throttled
    // notifications). Uses a local cache to avoid repeated DB lookups.
    // -------------------------------------------------------------------------
    const featureIdCache = new Map<string, number>();

    function getFeatureId(managedId: string): number | null {
      const cached = featureIdCache.get(managedId);
      if (cached != null) return cached;
      const sessionDbId = Effect.runSync(sp.getSessionDbId(managedId));
      if (!sessionDbId) return null;
      try {
        const row = Effect.runSync(
          database.queryOne<{ feature_id: number }>(
            "SELECT feature_id FROM agent_sessions WHERE id = ?",
            sessionDbId,
          ),
        );
        if (row) {
          featureIdCache.set(managedId, row.feature_id);
          return row.feature_id;
        }
        return null;
      } catch {
        return null;
      }
    }

    // -------------------------------------------------------------------------
    // Private: handle a single SDK message — routes to sub-handlers by type.
    // -------------------------------------------------------------------------

    function handleSdkMessage(
      managed: ManagedSubprocess,
      msg: Record<string, unknown>,
      sessionDbId: number | null,
    ): void {
      const { id, agentType } = managed;
      const type = msg.type as string;
      const parentToolUseId =
        (msg.parent_tool_use_id as string | null | undefined) ?? null;

      if (type === "stream_event") {
        handleStreamEvent(managed, msg, sessionDbId, parentToolUseId);
      } else if (type === "assistant") {
        handleAssistant(managed, msg, sessionDbId, parentToolUseId, id);
      } else if (type === "user") {
        handleUser(managed, msg, sessionDbId, parentToolUseId, id);
      } else if (type === "tool_result" || type === "result") {
        handleToolOrResult(managed, msg, type, agentType, id, sessionDbId, parentToolUseId);
      } else if (type === "system") {
        handleSystem(managed, msg, agentType, id, sessionDbId, parentToolUseId);
      }
    }

    function handleStreamEvent(
      managed: ManagedSubprocess,
      msg: Record<string, unknown>,
      sessionDbId: number | null,
      parentToolUseId: string | null,
    ): void {
      const innerEvent = msg.event as StreamEvent;
      if (!innerEvent) return;
      if (sessionDbId) {
        Effect.runSync(
          sp.persistStreamEvent(sessionDbId, innerEvent, parentToolUseId).pipe(
            Effect.catchAll(() => Effect.void),
          ),
        );
      }
      const fid = getFeatureId(managed.id);
      if (fid != null) Effect.runSync(eb.throttledNotify(managed.id, fid));
      for (const listener of managed.eventListeners) listener(innerEvent);
    }

    function handleAssistant(
      managed: ManagedSubprocess,
      msg: Record<string, unknown>,
      sessionDbId: number | null,
      parentToolUseId: string | null,
      id: string,
    ): void {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return;

      // Token usage
      if (sessionDbId) {
        const usage = message.usage as {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        } | undefined;
        if (usage) {
          const totalInput =
            (usage.input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0);
          const totalOutput = usage.output_tokens ?? 0;
          Effect.runSync(
            sp.updateTokenUsage(sessionDbId, totalInput, totalOutput).pipe(
              Effect.catchAll((e) => Effect.sync(() => {
                console.warn("[SdkQueryRunner] best-effort token update failed:", e);
              })),
            ),
          );
        }
      }

      // Model tracking
      if (sessionDbId && typeof message.model === "string") {
        Effect.runSync(sp.setSessionModel(sessionDbId, message.model));
      }

      // Content blocks
      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (!content) return;

      // Subagent turns (parent_tool_use_id != null) don't produce stream_event messages,
      // so we persist their content blocks from the full assistant message.
      const isSubagent = !!parentToolUseId;
      if (isSubagent && sessionDbId) {
        for (const block of content) {
          let event: StreamEvent | null = null;
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            event = {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: block.text },
            } as StreamEvent;
          } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
            event = {
              type: "content_block_start",
              index: 0,
              content_block: { type: "thinking", thinking: block.thinking },
            } as StreamEvent;
          } else if (block.type === "tool_use") {
            event = {
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "tool_use",
                id: block.id as string,
                name: block.name as string,
                input: block.input as Record<string, unknown>,
              },
            } as StreamEvent;
          }
          if (event) {
            Effect.runSync(
              sp.persistStreamEvent(sessionDbId, event, parentToolUseId).pipe(
                Effect.catchAll(() => Effect.void),
              ),
            );
          }
        }
        const fid = getFeatureId(id);
        if (fid != null) Effect.runSync(eb.throttledNotify(id, fid));
      }

      // Tool-use detection (background tasks, plan mode, etc.)
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const toolName = block.name as string;
        const toolInput = block.input as Record<string, unknown>;

        // EnterPlanMode → update DB permission_mode
        if (toolName === "EnterPlanMode" && sessionDbId) {
          Effect.runSync(
            database.execute(
              "UPDATE agent_sessions SET permission_mode = 'plan' WHERE id = ?",
              sessionDbId,
            ).pipe(
              Effect.flatMap(() =>
                database.queryOne<{ feature_id: number }>(
                  "SELECT feature_id FROM agent_sessions WHERE id = ?",
                  sessionDbId,
                ),
              ),
              Effect.flatMap((row) =>
                row
                  ? eb.notifyDbUpdated("agent_session", row.feature_id)
                  : Effect.void,
              ),
              Effect.catchAll((e) => Effect.sync(() => {
                console.warn("[SdkQueryRunner] best-effort plan-mode update failed:", e);
              })),
            ),
          );
        }

        // Background Bash task detection
        if (toolName === "Bash" && toolInput.run_in_background === true) {
          const tempId = block.id as string;
          Effect.runSync(bgTasks.add({
            id: tempId,
            tempId,
            subprocessId: id,
            kind: "bash",
            status: "running",
            command: typeof toolInput.command === "string" ? toolInput.command : undefined,
            spawnedAt: Date.now(),
          }));
        }

        // Background Task/Agent spawn detection
        if ((toolName === "Task" || toolName === "Agent") && toolInput.run_in_background === true) {
          const tempId = block.id as string;
          Effect.runSync(bgTasks.add({
            id: tempId,
            tempId,
            subprocessId: id,
            kind: "agent",
            status: "running",
            spawnedAt: Date.now(),
          }));
        }
      }
    }

    function handleUser(
      managed: ManagedSubprocess,
      msg: Record<string, unknown>,
      sessionDbId: number | null,
      parentToolUseId: string | null,
      id: string,
    ): void {
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return;
      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (!content || !Array.isArray(content)) return;

      for (const block of content) {
        if (block.type !== "tool_result") continue;

        const resultContent =
          typeof block.content === "string"
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
        if (sessionDbId) {
          Effect.runSync(
            sp.persistStreamEvent(sessionDbId, toolResultEvent, parentToolUseId).pipe(
              Effect.catchAll(() => Effect.void),
            ),
          );
        }

        // Extract real task IDs from background task tool_results
        const toolUseId = block.tool_use_id as string | undefined;
        if (toolUseId && resultContent) {
          const shellIdMatch = resultContent.match(/"?shell_?[Ii][Dd]"?\s*[:=]\s*"?([^",}\s]+)"?/);
          const taskIdMatch = resultContent.match(/"?task_?[Ii][Dd]"?\s*[:=]\s*"?([^",}\s]+)"?/);
          if (shellIdMatch?.[1]) {
            Effect.runSync(bgTasks.update(id, toolUseId, { id: shellIdMatch[1] }));
          } else if (taskIdMatch?.[1]) {
            Effect.runSync(bgTasks.update(id, toolUseId, { id: taskIdMatch[1] }));
          }
        }
      }

      const fid = getFeatureId(id);
      if (fid != null) Effect.runSync(eb.throttledNotify(id, fid));
    }

    function handleToolOrResult(
      managed: ManagedSubprocess,
      msg: Record<string, unknown>,
      type: string,
      agentType: string,
      id: string,
      sessionDbId: number | null,
      parentToolUseId: string | null,
    ): void {
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
        if (sessionDbId) {
          Effect.runSync(
            sp.persistStreamEvent(sessionDbId, toolResultEvent, parentToolUseId).pipe(
              Effect.catchAll(() => Effect.void),
            ),
          );
        }
        const fid = getFeatureId(id);
        if (fid != null) Effect.runSync(eb.throttledNotify(id, fid));
      } else {
        // type === "result"
        Effect.runSync(
          eb.broadcastAgentEvent(
            id,
            agentType as AgentType,
            {
              type: "result",
              result: msg.result as string | undefined,
              cost_usd: msg.cost_usd as number | undefined,
              duration_ms: msg.duration_ms as number | undefined,
            } as StreamEvent,
            parentToolUseId,
          ),
        );
        if (agentType === "session") {
          // Session agents stay alive between turns — broadcast turn_complete
          Effect.runSync(
            eb.broadcastAgentEvent(id, agentType as AgentType, { type: "turn_complete" }),
          );
        } else {
          // Non-session agents: close the message stream so the for-await loop exits
          if (managed.closeMessageStream) {
            managed.closeMessageStream();
          }
        }
      }
    }

    function handleSystem(
      managed: ManagedSubprocess,
      msg: Record<string, unknown>,
      agentType: string,
      id: string,
      sessionDbId: number | null,
      parentToolUseId: string | null,
    ): void {
      // Capture SDK session ID for resume after interrupt
      if (msg.session_id && typeof msg.session_id === "string") {
        managed.sdkSessionId = msg.session_id;
        if (sessionDbId) {
          Effect.runSync(
            sp.persistClaudeSessionId(sessionDbId, msg.session_id).pipe(
              Effect.catchAll(() => Effect.void),
            ),
          );
        }
      }

      const subtype = (msg.subtype as string) ?? "unknown";

      // Background task notification
      if (subtype === "task_notification") {
        const taskId = msg.task_id as string | undefined;
        const taskStatus = msg.status as string | undefined;
        const taskSummary = msg.summary as string | undefined;
        const outputFile = msg.output_file as string | undefined;
        if (taskId) {
          const update: Partial<import("../../agents/background-tasks.js").BackgroundTask> = {
            status:
              taskStatus === "completed" || taskStatus === "failed" || taskStatus === "stopped"
                ? taskStatus
                : "completed",
            completedAt: Date.now(),
          };
          if (taskSummary) update.summary = taskSummary;
          if (outputFile) update.outputFile = outputFile;
          Effect.runSync(bgTasks.update(id, taskId, update));
        }
      }

      // Compact boundary — update DB and broadcast
      if (subtype === "compact_boundary" && sessionDbId) {
        Effect.runSync(
          database.execute(
            "UPDATE agent_sessions SET was_compacted = 1 WHERE id = ?",
            sessionDbId,
          ).pipe(
            Effect.catchAll((e) => Effect.sync(() => {
              console.warn("[SdkQueryRunner] best-effort compact update failed:", e);
            })),
          ),
        );
        Effect.runSync(
          sp.persistStreamEvent(
            sessionDbId,
            { type: "system", subtype: "compact_boundary" } as StreamEvent,
            parentToolUseId,
          ).pipe(Effect.catchAll(() => Effect.void)),
        );
        Effect.runSync(
          eb.broadcastAgentEvent(
            id,
            agentType as AgentType,
            { type: "system", subtype: "compact_boundary" } as StreamEvent,
            parentToolUseId,
          ),
        );
      }

      const fid = getFeatureId(id);
      if (fid != null) Effect.runSync(eb.throttledNotify(id, fid));
    }

    // -------------------------------------------------------------------------
    // Service implementation
    // -------------------------------------------------------------------------

    return {
      execute: (
        managed: ManagedSubprocess,
        options: SubprocessOptions,
      ): Effect.Effect<void, SdkError> =>
        Effect.tryPromise({
          try: async () => {
            const sdk = await getSdkClient();
            const cliInfo = await discoverClaudeCli();
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
              console.log(
                `[SdkQueryRunner] Resuming session ${options.resumeSessionId} for ${managed.id}, model=${options.model}`,
              );
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

            queryOptions.canUseTool = createCanUseToolHandler(managed);

            const messageStream = createMessageStream(options.prompt as MessageContent);
            managed.pushMessage = messageStream.push as (msg: import("../../agents/types.js").MessageContent) => void;
            managed.closeMessageStream = messageStream.close;

            const queryObj = sdk.query({
              prompt: messageStream.generator,
              options: queryOptions,
            });

            managed.query = queryObj as import("@anthropic-ai/claude-agent-sdk").Query;

            const isResume = !!options.resumeSessionId;
            let messageCount = 0;

            // Cache the session DB ID for the duration of this query.
            // Uses runPromise here (async context) so that if getSessionDbId
            // ever becomes async it will continue to work correctly.
            const sessionDbId = await Effect.runPromise(sp.getSessionDbId(managed.id));

            try {
              for await (const message of queryObj) {
                messageCount++;
                if (managed.status === "stopped") break;
                handleSdkMessage(
                  managed,
                  message as Record<string, unknown>,
                  sessionDbId,
                );
              }

              console.log(
                `[SdkQueryRunner] SDK query finished for ${managed.id}: ` +
                `status=${managed.status}, messages=${messageCount}, resume=${isResume}`,
              );

              if (managed.status === "running") {
                await Effect.runPromise(completion.onCompleted(managed, managed.sdkSessionId));
              } else if (managed.status === "paused") {
                await Effect.runPromise(completion.onPaused(managed));
              } else if (managed.status === "stopped") {
                await Effect.runPromise(completion.onStopped(managed, managed.sdkSessionId));
              }
            } catch (err) {
              if (managed.status === "paused") {
                await Effect.runPromise(completion.onPaused(managed));
              } else if (managed.status === "stopped") {
                await Effect.runPromise(completion.onStopped(managed));
              } else {
                await Effect.runPromise(completion.onError(managed, err));
              }
            } finally {
              if (managed.status !== "paused") {
                messageStream.close();
                Effect.runSync(bgTasks.clear(managed.id));
              }
            }
          },
          catch: (e) =>
            new SdkError({
              message: e instanceof Error ? e.message : String(e),
              cause: e,
            }),
        }),
    };
  }),
);

// ---------------------------------------------------------------------------
// Re-export resolveModel for subprocess-manager convenience
// ---------------------------------------------------------------------------
export { resolveModel } from "../../agents/models.js";
