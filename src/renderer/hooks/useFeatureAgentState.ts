/**
 * Single hook that provides all agent state for a feature.
 *
 * Data flows:
 *   1. `trpc.agents.getFeatureAgentState` — canonical state from DB (pre-built nested blocks)
 *   2. `streamingBuffer` — flat list of blocks from IPC events between query refreshes
 *   3. On agent_done / agent_paused / result: clear buffer, refetch
 *   4. Merge step nests buffer blocks under their parent Task blocks
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { trpc } from "@/trpc";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentEvent, AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentSession";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

let streamIdCounter = 0;
function makeStreamBlock(partial: Omit<AgentBlockData, "id">, messageDbId?: number): AgentBlockData {
  const id = messageDbId ? `msg-${messageDbId}` : `stream-${++streamIdCounter}`;
  return { id, messageDbId, ...partial };
}

/** Recursively find a Task block's childBlocks by toolUseId */
function findChildList(blocks: AgentBlockData[], toolUseId: string): AgentBlockData[] | null {
  for (const b of blocks) {
    if (b.type === "tool_call" && b.toolUseId === toolUseId && b.childBlocks) {
      return b.childBlocks;
    }
    if (b.childBlocks) {
      const found = findChildList(b.childBlocks, toolUseId);
      if (found) return found;
    }
  }
  return null;
}

/** Apply a streaming result (append/delta/delta_json) to a block list in-place */
function applyResult(
  result: NonNullable<ReturnType<typeof eventToBlock>>,
  list: AgentBlockData[],
  messageDbId?: number,
): void {
  if (result.action === "append") {
    // Deduplicate tool_call blocks by toolUseId — the SDK may send the same
    // tool_use via both stream_event and assistant messages
    if (result.block.type === "tool_call" && result.block.toolUseId) {
      const existing = list.find((b) => b.type === "tool_call" && b.toolUseId === result.block.toolUseId);
      if (existing) {
        if (result.block.content && result.block.content.length > (existing.content?.length ?? 0)) {
          existing.content = result.block.content;
          existing.toolArgs = result.block.toolArgs;
        }
        return;
      }
    }
    const newBlock = makeStreamBlock(result.block, messageDbId);
    // Resolve sourceToolName for tool_result blocks by matching tool_use_id
    if (newBlock.type === "tool_result" && newBlock.toolUseId) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].type === "tool_call" && list[i].toolUseId === newBlock.toolUseId) {
          newBlock.sourceToolName = list[i].toolName;
          break;
        }
      }
    } else if (newBlock.type === "tool_result" && !newBlock.toolUseId) {
      // Fallback: find the last tool_call in the list
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].type === "tool_call") {
          newBlock.sourceToolName = list[i].toolName;
          break;
        }
      }
    }
    list.push(newBlock);
  } else if (result.action === "delta") {
    if (list.length > 0 && list[list.length - 1].type === "text") {
      list[list.length - 1] = {
        ...list[list.length - 1],
        content: list[list.length - 1].content + result.text,
      };
    } else {
      list.push(makeStreamBlock({ type: "text", content: result.text }));
    }
  } else if (result.action === "delta_json") {
    if (list.length > 0 && list[list.length - 1].type === "tool_call") {
      const last = list[list.length - 1];
      list[list.length - 1] = {
        ...last,
        toolArgs: (last.toolArgs ?? "") + result.json,
        content: (last.content ?? "") + result.json,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Convert a stream event to block(s)
// ---------------------------------------------------------------------------

export function eventToBlock(
  event: AgentEvent,
): { action: "append"; block: Omit<AgentBlockData, "id"> } | { action: "delta"; text: string } | { action: "delta_json"; json: string } | null {
  const e = event.event;
  switch (e.type) {
    case "content_block_start":
      if (e.content_block.type === "text") {
        return { action: "append", block: { type: "text", content: e.content_block.text, parentToolUseId: event.parentToolUseId } };
      } else if (e.content_block.type === "tool_use") {
        const hasInput = e.content_block.input && Object.keys(e.content_block.input).length > 0;
        return {
          action: "append",
          block: {
            type: "tool_call",
            content: hasInput ? JSON.stringify(e.content_block.input, null, 2) : "",
            toolName: e.content_block.name,
            toolArgs: hasInput ? JSON.stringify(e.content_block.input, null, 2) : "",
            toolUseId: e.content_block.id,
            parentToolUseId: event.parentToolUseId,
            childBlocks: e.content_block.name === "Task" ? [] : undefined,
          },
        };
      }
      return null;
    case "content_block_delta":
      if (e.delta.type === "text_delta") {
        return { action: "delta", text: e.delta.text };
      } else if (e.delta.type === "input_json_delta") {
        return { action: "delta_json", json: e.delta.partial_json };
      }
      return null;
    case "tool_result":
      return {
        action: "append",
        block: {
          type: "tool_result",
          content: e.content,
          isError: e.is_error ?? false,
          parentToolUseId: event.parentToolUseId,
          toolUseId: e.tool_use_id,
        },
      };
    case "error":
      return {
        action: "append",
        block: { type: "text", content: `Error: ${e.error.message}`, parentToolUseId: event.parentToolUseId },
      };
    case "user_message":
      return {
        action: "append",
        block: { type: "user_message", content: e.content, parentToolUseId: event.parentToolUseId },
      };
    case "system": {
      const sysEvent = e as { subtype?: string };
      if (sysEvent.subtype === "compact_boundary") {
        return { action: "append", block: { type: "compact_divider" as const, content: "" } };
      }
      return null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Convert server blocks (plain objects) to AgentBlockData (with IDs)
// ---------------------------------------------------------------------------

interface ServerBlock {
  id: string;
  type: string;
  content: string;
  toolName?: string;
  toolArgs?: string;
  isError?: boolean;
  toolUseId?: string;
  parentToolUseId?: string | null;
  childBlocks?: ServerBlock[];
  sourceToolName?: string;
}

function serverBlocksToAgentBlocks(serverBlocks: ServerBlock[]): AgentBlockData[] {
  return serverBlocks.map((sb) => ({
    id: sb.id,
    type: sb.type as AgentBlockData["type"],
    content: sb.content,
    toolName: sb.toolName,
    toolArgs: sb.toolArgs,
    isError: sb.isError,
    toolUseId: sb.toolUseId,
    parentToolUseId: sb.parentToolUseId,
    childBlocks: sb.childBlocks ? serverBlocksToAgentBlocks(sb.childBlocks) : undefined,
    sourceToolName: sb.sourceToolName,
  }));
}

// ---------------------------------------------------------------------------
// Session shape exposed to consumers
// ---------------------------------------------------------------------------

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface FeatureSession {
  sessionDbId: number;
  agentType: AgentType;
  status: AgentStatus;
  subprocessId: string | null;
  model: string | null;
  blocks: AgentBlockData[];
  pendingQuestions: AgentQuestion[] | null;
  hasFileChanges: boolean;
  resumable: boolean;
  claudeSessionId: string | null;
  runId: number | null;
  phaseId: number | null;
  phaseTitle: string | null;
  todos: TodoItem[] | null;
  permissionMode: string;
  pendingPlanApproval: { allowedPrompts?: Array<{ tool: string; prompt: string }> } | null;
  pendingPermission: PendingPermission | null;
  inputTokens: number;
  outputTokens: number;
  contextWindow: number;
  wasCompacted: boolean;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useFeatureAgentState(featureId: number) {
  const query = trpc.agents.getFeatureAgentState.useQuery({ featureId });

  // Streaming buffer: sessionDbId -> flat list of extra blocks since last query
  const [streamBuffer, setStreamBuffer] = useState<Map<number, AgentBlockData[]>>(new Map());
  // Streaming todos: sessionDbId -> latest TodoWrite todos captured during streaming
  const streamingTodosRef = useRef<Map<number, TodoItem[]>>(new Map());
  const [streamingTodosVersion, setStreamingTodosVersion] = useState(0);
  // Track running subprocess -> sessionDbId mapping
  const sessionMapRef = useRef<Map<string, number>>(new Map());
  // Track in-progress TodoWrite tool call JSON accumulation: toolUseId -> partial JSON
  const todoJsonAccumRef = useRef<Map<string, string>>(new Map());
  // Track which toolUseId is a TodoWrite: toolUseId -> sessionDbId
  const todoToolUseRef = useRef<Map<string, number>>(new Map());
  // Track toolUseId -> toolName for resolving sourceToolName on tool_result blocks.
  // This persists across buffer trims so we can resolve even after the tool_call
  // block has moved from buffer to server blocks.
  const toolUseNameRef = useRef<Map<string, string>>(new Map());
  // Stable ref to query.refetch so the IPC effect doesn't re-register every render
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  // Reset buffer on featureId change
  useEffect(() => {
    setStreamBuffer(new Map());
    streamingTodosRef.current = new Map();
    todoJsonAccumRef.current = new Map();
    todoToolUseRef.current = new Map();
    toolUseNameRef.current = new Map();
    sessionMapRef.current = new Map();
  }, [featureId]);

  // Build the sessionMap from query data and clear stale buffer entries.
  // When query data refreshes (e.g. after notifyDbUpdated), the DB now contains
  // messages that were previously only in the stream buffer.  Clearing the buffer
  // avoids duplicates — any new stream events arriving after this point will have
  // messageDbId > maxMessageId and pass the dedup filter.
  useEffect(() => {
    if (!query.data) return;
    const map = new Map<string, number>();
    for (const s of query.data.sessions) {
      if (s.subprocessId) {
        map.set(s.subprocessId, s.sessionDbId);
      }
    }
    sessionMapRef.current = map;

    // Trim buffer: drop blocks already covered by the new query snapshot
    setStreamBuffer((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const s of query.data!.sessions) {
        const buf = next.get(s.sessionDbId);
        if (!buf || buf.length === 0) continue;
        const maxMsgId = s.maxMessageId ?? 0;
        const filtered = buf.filter((b) => b.messageDbId != null && b.messageDbId > maxMsgId);
        if (filtered.length !== buf.length) {
          changed = true;
          if (filtered.length === 0) {
            next.delete(s.sessionDbId);
          } else {
            next.set(s.sessionDbId, filtered);
          }
        }
      }
      return changed ? next : prev;
    });
  }, [query.data]);

  // IPC event listener
  useEffect(() => {
    const api = (
      window as unknown as {
        api?: {
          onAgentEvent: (cb: (event: unknown) => void) => unknown;
          offAgentEvent: (listener?: unknown) => void;
        };
      }
    ).api;
    if (!api) return;

    const listener = api.onAgentEvent((data: unknown) => {
      const agentEvent = data as AgentEvent;

      // Map subprocess to sessionDbId
      let sessionDbId = agentEvent.sessionDbId;
      if (!sessionDbId && agentEvent.subprocessId) {
        sessionDbId = sessionMapRef.current.get(agentEvent.subprocessId);
      }

      // Register new subprocess -> sessionDbId mapping
      if (agentEvent.subprocessId && agentEvent.sessionDbId) {
        sessionMapRef.current.set(agentEvent.subprocessId, agentEvent.sessionDbId);
      }

      if (!sessionDbId) return;

      const e = agentEvent.event;

      // Terminal events: clear buffer and streaming todos, refetch
      if (
        e.type === "agent_done" ||
        e.type === "agent_paused" ||
        e.type === "result"
      ) {
        setStreamBuffer((prev) => {
          const next = new Map(prev);
          next.delete(sessionDbId);
          return next;
        });
        streamingTodosRef.current.delete(sessionDbId);
        setStreamingTodosVersion((v) => v + 1);
        void refetchRef.current();
        return;
      }

      // Track tool_use_id -> tool name for resolving sourceToolName on tool_result
      if (e.type === "content_block_start" && e.content_block?.type === "tool_use" && e.content_block.id) {
        toolUseNameRef.current.set(e.content_block.id, e.content_block.name);
      }

      // Track TodoWrite tool calls during streaming
      if (e.type === "content_block_start" && e.content_block?.type === "tool_use" && e.content_block.name === "TodoWrite") {
        const toolUseId = e.content_block.id;
        todoToolUseRef.current.set(toolUseId, sessionDbId);
        todoJsonAccumRef.current.set(toolUseId, "");
        // If the input is already complete (non-streaming), parse immediately
        if (e.content_block.input && Object.keys(e.content_block.input).length > 0) {
          const input = e.content_block.input as { todos?: TodoItem[] };
          if (input.todos && Array.isArray(input.todos)) {
            streamingTodosRef.current.set(sessionDbId, input.todos);
            setStreamingTodosVersion((v) => v + 1);
          }
        }
      } else if (e.type === "content_block_delta" && e.delta?.type === "input_json_delta") {
        // Accumulate JSON deltas for any in-progress TodoWrite
        for (const [toolUseId, sid] of todoToolUseRef.current.entries()) {
          if (todoJsonAccumRef.current.has(toolUseId)) {
            const accum = todoJsonAccumRef.current.get(toolUseId)! + e.delta.partial_json;
            todoJsonAccumRef.current.set(toolUseId, accum);
            // Try to parse the accumulated JSON
            try {
              const parsed = JSON.parse(accum);
              if (parsed.todos && Array.isArray(parsed.todos)) {
                streamingTodosRef.current.set(sid, parsed.todos);
                setStreamingTodosVersion((v) => v + 1);
              }
            } catch {
              // Not complete JSON yet, continue accumulating
            }
          }
        }
      } else if (e.type === "content_block_stop") {
        // Clean up accumulated JSON for completed tool uses
        // We can't easily know which toolUseId stopped, but that's fine —
        // the accumulated data persists until terminal event or next TodoWrite
      }

      // Convert event to block and append to flat buffer
      const result = eventToBlock(agentEvent);
      if (!result) return;

      setStreamBuffer((prev) => {
        const next = new Map(prev);
        const existing = [...(next.get(sessionDbId) ?? [])];
        applyResult(result, existing, agentEvent.messageDbId);
        // Resolve sourceToolName for freshly appended tool_result blocks
        // using the persistent toolUseNameRef (survives buffer trims)
        if (result.action === "append" && result.block.type === "tool_result") {
          const last = existing[existing.length - 1];
          if (last && last.type === "tool_result" && !last.sourceToolName) {
            if (last.toolUseId && toolUseNameRef.current.has(last.toolUseId)) {
              last.sourceToolName = toolUseNameRef.current.get(last.toolUseId);
            }
          }
        }
        next.set(sessionDbId, existing);
        return next;
      });
    });

    return () => {
      api.offAgentEvent(listener as undefined);
    };
  }, [featureId]);

  // Parse question helper
  const parseQuestions = useCallback((raw: unknown): AgentQuestion[] | null => {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const questions: AgentQuestion[] = [];
    if (Array.isArray(obj.questions)) {
      for (const q of obj.questions) {
        const qObj = q as { question: string; options?: unknown[] };
        questions.push({
          question: qObj.question,
          options: Array.isArray(qObj.options)
            ? qObj.options.map((opt) => {
                if (typeof opt === "string") return { label: opt };
                if (opt && typeof opt === "object" && "label" in opt) {
                  const o = opt as { label: string; description?: string };
                  return { label: o.label, description: o.description };
                }
                return { label: String(opt) };
              })
            : [],
        });
      }
    }
    return questions.length > 0 ? questions : null;
  }, []);

  // Merge server blocks + streaming buffer, deduplicating by ID
  // (streamingTodosVersion triggers re-render when streaming todos update)
  void streamingTodosVersion;
  const sessions: FeatureSession[] = (query.data?.sessions ?? []).map((s) => {
    const queryBlocks = serverBlocksToAgentBlocks(s.blocks as ServerBlock[]);
    const rawBufferBlocks = streamBuffer.get(s.sessionDbId) ?? [];
    const maxMsgId = s.maxMessageId ?? 0;

    // Collect toolUseIds already present in server blocks (including nested)
    const serverToolUseIds = new Set<string>();
    function collectToolUseIds(blocks: AgentBlockData[]) {
      for (const b of blocks) {
        if (b.toolUseId) serverToolUseIds.add(b.toolUseId);
        if (b.childBlocks) collectToolUseIds(b.childBlocks);
      }
    }
    collectToolUseIds(queryBlocks);

    // Filter buffer blocks: skip any already covered by server data
    // - messageDbId <= maxMessageId means it's in the DB query result
    // - toolUseId already in server blocks means it's a duplicate tool_call
    // Deep-clone buffer blocks to prevent the merge step from mutating
    // React state (specifically, pushing into childBlocks arrays that
    // persist across renders, which caused subagent blocks to accumulate).
    const bufferBlocks = rawBufferBlocks
      .filter((b) => {
        if (b.messageDbId && b.messageDbId <= maxMsgId) return false;
        if (b.type === "tool_call" && b.toolUseId && serverToolUseIds.has(b.toolUseId)) return false;
        return true;
      })
      .map((b) => ({
        ...b,
        childBlocks: b.childBlocks ? [...b.childBlocks] : undefined,
      }));

    // Nest buffer blocks under their parent Task blocks (parent may be in query or buffer)
    const merged = [...queryBlocks];
    const topLevel: AgentBlockData[] = [];
    for (const b of bufferBlocks) {
      if (b.parentToolUseId) {
        const parentList = findChildList(merged, b.parentToolUseId)
          ?? findChildList(topLevel, b.parentToolUseId);
        if (parentList) {
          parentList.push(b);
          continue;
        }
      }
      topLevel.push(b);
    }
    merged.push(...topLevel);

    const status: AgentStatus =
      s.status === "running" || s.status === "paused" || s.status === "completed" || s.status === "error"
        ? s.status
        : s.status === "waiting"
          ? "paused"
          : "idle";

    // Prefer streaming todos over server todos (more up-to-date during active streaming)
    const serverTodos = (s.todos as TodoItem[] | null) ?? null;
    const streamTodos = streamingTodosRef.current.get(s.sessionDbId) ?? null;
    const todos = streamTodos ?? serverTodos;

    return {
      sessionDbId: s.sessionDbId,
      agentType: s.agentType as AgentType,
      status,
      subprocessId: s.subprocessId,
      model: s.model,
      blocks: merged,
      pendingQuestions: parseQuestions(s.pendingQuestions),
      hasFileChanges: s.hasFileChanges,
      resumable: s.resumable,
      claudeSessionId: s.claudeSessionId,
      runId: s.runId,
      phaseId: s.phaseId,
      phaseTitle: s.phaseTitle,
      todos,
      permissionMode: s.permissionMode ?? "acceptEdits",
      pendingPlanApproval: s.pendingPlanApproval ?? null,
      pendingPermission: s.pendingPermission ?? null,
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
      contextWindow: s.contextWindow ?? 200000,
      wasCompacted: s.wasCompacted ?? false,
    };
  });

  return {
    sessions,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
