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

// ---------------------------------------------------------------------------
// Block helpers
// ---------------------------------------------------------------------------

let streamIdCounter = 0;
function makeStreamBlock(partial: Omit<AgentBlockData, "id">, messageDbId?: number): AgentBlockData {
  const id = messageDbId ? `msg-${messageDbId}` : `stream-${++streamIdCounter}`;
  return { id, ...partial };
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
    list.push(makeStreamBlock(result.block, messageDbId));
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
        },
      };
    case "error":
      return {
        action: "append",
        block: { type: "text", content: `Error: ${e.error.message}`, parentToolUseId: event.parentToolUseId },
      };
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
  }));
}

// ---------------------------------------------------------------------------
// Session shape exposed to consumers
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useFeatureAgentState(featureId: number) {
  const query = trpc.agents.getFeatureAgentState.useQuery({ featureId });

  // Streaming buffer: sessionDbId -> flat list of extra blocks since last query
  const [streamBuffer, setStreamBuffer] = useState<Map<number, AgentBlockData[]>>(new Map());
  // Track running subprocess -> sessionDbId mapping
  const sessionMapRef = useRef<Map<string, number>>(new Map());
  // Stable ref to query.refetch so the IPC effect doesn't re-register every render
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  // Reset buffer on featureId change
  useEffect(() => {
    setStreamBuffer(new Map());
    sessionMapRef.current = new Map();
  }, [featureId]);

  // Build the sessionMap from query data
  useEffect(() => {
    if (!query.data) return;
    const map = new Map<string, number>();
    for (const s of query.data.sessions) {
      if (s.subprocessId) {
        map.set(s.subprocessId, s.sessionDbId);
      }
    }
    sessionMapRef.current = map;
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

      // Terminal events: clear buffer and refetch
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
        void refetchRef.current();
        return;
      }

      // Convert event to block and append to flat buffer
      const result = eventToBlock(agentEvent);
      if (!result) return;

      setStreamBuffer((prev) => {
        const next = new Map(prev);
        const existing = [...(next.get(sessionDbId) ?? [])];
        applyResult(result, existing, agentEvent.messageDbId);
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
  const sessions: FeatureSession[] = (query.data?.sessions ?? []).map((s) => {
    const queryBlocks = serverBlocksToAgentBlocks(s.blocks as ServerBlock[]);
    const rawBufferBlocks = streamBuffer.get(s.sessionDbId) ?? [];

    // Collect all IDs present in server data (including nested childBlocks)
    const serverIds = new Set<string>();
    function collectIds(blocks: AgentBlockData[]) {
      for (const b of blocks) {
        serverIds.add(b.id);
        if (b.childBlocks) collectIds(b.childBlocks);
      }
    }
    collectIds(queryBlocks);

    // Filter buffer blocks: skip any whose ID already exists in server data
    const bufferBlocks = rawBufferBlocks.filter((b) => !serverIds.has(b.id));

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

    return {
      sessionDbId: s.sessionDbId,
      agentType: s.agentType as AgentType,
      status: bufferBlocks.length > 0 && status !== "running" ? "running" : status,
      subprocessId: s.subprocessId,
      model: s.model,
      blocks: merged,
      pendingQuestions: parseQuestions(s.pendingQuestions),
      hasFileChanges: s.hasFileChanges,
      resumable: s.resumable,
      claudeSessionId: s.claudeSessionId,
      runId: s.runId,
      phaseId: s.phaseId,
    };
  });

  return {
    sessions,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
