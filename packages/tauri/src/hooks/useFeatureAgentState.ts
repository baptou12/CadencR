/**
 * Single hook that provides all agent state for a feature.
 *
 * Data flows through a single path:
 *   1. `useGetFeatureAgentState` — canonical state from DB (pre-built nested blocks)
 *   2. React Query polling and WebSocket events drive refetches
 *
 * Incremental fetching: after the first full load, subsequent fetches only request
 * messages newer than what we already have (via `afterMessageIds`). The server returns
 * partial blocks that are merged into the accumulated state on the client.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useGetFeatureAgentState, fetchFeatureAgentState } from "../api/generated";
import type { AgentBlock } from "../api/generated";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType } from "../types/agent-types";
import type { AgentStatus, TodoItem } from "@/types/agent";
import { parseAskUserQuestions } from "@/components/AgentQuestionDrawer";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";

/** Number of messages to fetch per session on initial load */
const INITIAL_MESSAGE_LIMIT = 100;
/** Number of messages to fetch when loading older history */
const OLDER_MESSAGE_LIMIT = 100;

// ---------------------------------------------------------------------------
// Convert server blocks (plain objects) to AgentBlockData (with IDs)
// ---------------------------------------------------------------------------

export function serverBlocksToAgentBlocks(serverBlocks: AgentBlock[]): AgentBlockData[] {
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
    createdAt: sb.createdAt,
    model: sb.model,
  }));
}

// ---------------------------------------------------------------------------
// Accumulated session state for incremental merging
// ---------------------------------------------------------------------------

interface AccumulatedSession {
  blocks: AgentBlockData[];
  maxMessageId: number;
  /** toolUseId → { toolName, block ref (for nesting child blocks) } */
  toolUseIdMap: Map<string, { toolName: string; block: AgentBlockData }>;
  /** Cached todos — preserved across incremental updates when server returns null */
  todos: TodoItem[] | null;
  /** Whether older messages exist beyond the current window */
  hasMore: boolean;
  /** Lowest message ID in the current window (cursor for loading older) */
  oldestMessageId: number | null;
}

/** Build the toolUseIdMap from a complete block tree (used on full fetch). */
function buildToolUseIdMap(blocks: AgentBlockData[]): Map<string, { toolName: string; block: AgentBlockData }> {
  const map = new Map<string, { toolName: string; block: AgentBlockData }>();
  function walk(list: AgentBlockData[]) {
    for (const b of list) {
      if (b.type === "tool_call" && b.toolUseId) {
        map.set(b.toolUseId, { toolName: b.toolName ?? "tool", block: b });
      }
      if (b.childBlocks) walk(b.childBlocks);
    }
  }
  walk(blocks);
  return map;
}

/**
 * Merge incremental blocks into the accumulated block tree.
 *
 * Handles:
 * - Text/thinking boundary merging (consecutive blocks of same type are concatenated)
 * - Re-nesting: blocks with parentToolUseId are placed into the parent's childBlocks
 * - sourceToolName resolution for tool_result blocks via toolUseIdMap
 * - Registering new tool_call blocks in toolUseIdMap
 */
function mergeIncrementalBlocks(
  acc: AccumulatedSession,
  newBlocks: AgentBlockData[],
): void {
  for (const block of newBlocks) {
    // Determine the target list (root or nested under a parent tool_call)
    let targetList: AgentBlockData[];
    if (block.parentToolUseId) {
      const parent = acc.toolUseIdMap.get(block.parentToolUseId);
      if (parent?.block.childBlocks) {
        targetList = parent.block.childBlocks;
      } else {
        targetList = acc.blocks;
      }
    } else {
      targetList = acc.blocks;
    }

    // Resolve sourceToolName for tool_result blocks that couldn't find their
    // parent tool_call in the partial buildBlocks pass
    if (block.type === "tool_result" && !block.sourceToolName && block.toolUseId) {
      const entry = acc.toolUseIdMap.get(block.toolUseId);
      if (entry) block.sourceToolName = entry.toolName;
    }

    // Register tool_call blocks so future incremental batches can nest into them
    if (block.type === "tool_call" && block.toolUseId) {
      acc.toolUseIdMap.set(block.toolUseId, { toolName: block.toolName ?? "tool", block });
    }

    // Merge text/thinking at boundary
    const last = targetList.length > 0 ? targetList[targetList.length - 1] : null;
    if (
      last &&
      block.type === last.type &&
      (block.type === "text" || block.type === "thinking") &&
      !last.parentToolUseId === !block.parentToolUseId
    ) {
      last.content += block.content;
    } else {
      targetList.push(block);
    }
  }
}

/**
 * Apply in-place updates to tool_call blocks whose content was updated
 * via input_json_delta after the initial insert (invisible to incremental fetch).
 * Returns true if any block was updated.
 */
function applyToolCallUpdates(
  blocks: AgentBlockData[],
  updates: Record<string, string>,
): boolean {
  let changed = false;
  function walk(list: AgentBlockData[]) {
    for (const b of list) {
      if (b.id in updates) {
        const newContent = updates[b.id];
        if (b.content !== newContent) {
          b.content = newContent;
          b.toolArgs = newContent;
          changed = true;
        }
      }
      if (b.childBlocks) walk(b.childBlocks);
    }
  }
  walk(blocks);
  return changed;
}

// ---------------------------------------------------------------------------
// Session shape exposed to consumers
// ---------------------------------------------------------------------------

// Re-exported from @/types/agent
export type { TodoItem } from "@/types/agent";

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
  draftPrompt: string | null;
  hasMore: boolean;
  oldestMessageId: number | null;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useFeatureAgentState(featureId: number) {
  const accumulatedRef = useRef(new Map<number, AccumulatedSession>());
  // dataVersion is incremented after processing new query data so that
  // afterMessageIds recomputes and the next fetch uses incremental cursors.
  const [dataVersion, setDataVersion] = useState(0);

  // Reset accumulated state when feature changes (synchronous, not useEffect,
  // to avoid clearing the ref after useMemo populates it on the same render).
  const prevFeatureIdRef = useRef(featureId);
  if (prevFeatureIdRef.current !== featureId) {
    accumulatedRef.current = new Map();
    prevFeatureIdRef.current = featureId;
  }

  // Derive afterMessageIds from the accumulated state.
  // dataVersion is read to ensure this recomputes after processing new data.
  // React Query serializes the input for cache keying, so a new object with
  // the same values produces the same key (no spurious refetches).
  void dataVersion;
  let afterMessageIds: Record<string, number> | undefined;
  if (accumulatedRef.current.size > 0) {
    afterMessageIds = {};
    for (const [sid, acc] of accumulatedRef.current) {
      afterMessageIds[String(sid)] = acc.maxMessageId;
    }
  }

  const afterParam = afterMessageIds ? JSON.stringify(afterMessageIds) : undefined;
  // Only apply limit on initial load (no afterMessageIds yet)
  const initialLimit = afterMessageIds ? undefined : INITIAL_MESSAGE_LIMIT;
  const query = useGetFeatureAgentState(featureId, afterParam, { keepPreviousData: true }, initialLimit);

  const parseQuestions = useCallback((raw: unknown): AgentQuestion[] | null => {
    if (!raw || typeof raw !== "object") return null;
    const result = parseAskUserQuestions(raw as Record<string, unknown>);
    return result.length > 0 ? result : null;
  }, []);

  // Track which query.data we last processed to guard against React strict mode
  // calling useMemo twice with the same input (which would double-append blocks).
  const lastProcessedDataRef = useRef<unknown>(null);

  // Process query data: merge incremental blocks into accumulated state
  const sessions: FeatureSession[] = useMemo(() => {
    const serverSessions = query.data?.sessions ?? [];
    if (serverSessions.length === 0 && accumulatedRef.current.size === 0) return [];

    const accMap = accumulatedRef.current;

    // Only mutate the accumulated ref if this is genuinely new data.
    // React strict mode may call useMemo twice with the same input;
    // without this guard incremental blocks would be appended twice.
    const isNewData = query.data !== lastProcessedDataRef.current;
    if (isNewData) {
      lastProcessedDataRef.current = query.data;

      // Track which sessions are still present from the server
      const currentSessionIds = new Set(serverSessions.map((s) => s.sessionDbId));

      // Remove sessions that disappeared from the server response
      for (const sid of accMap.keys()) {
        if (!currentSessionIds.has(sid)) accMap.delete(sid);
      }

      for (const s of serverSessions) {
        const newBlocks = serverBlocksToAgentBlocks(s.blocks);
        let acc = accMap.get(s.sessionDbId);

        if (!s.isIncremental || !acc) {
          // Full replacement: rebuild accumulated state from scratch
          acc = {
            blocks: newBlocks,
            maxMessageId: s.maxMessageId,
            toolUseIdMap: buildToolUseIdMap(newBlocks),
            todos: (s.todos as TodoItem[] | null) ?? null,
            hasMore: s.hasMore ?? false,
            oldestMessageId: s.oldestMessageId ?? null,
          };
          accMap.set(s.sessionDbId, acc);
        } else {
          // Incremental: merge new blocks into accumulated state.
          // Create a new array reference so React detects the change
          // (mergeIncrementalBlocks mutates in place for efficiency,
          // but useLayoutEffect in AgentSession depends on [blocks] identity).
          if (newBlocks.length > 0) {
            mergeIncrementalBlocks(acc, newBlocks);
            acc.blocks = [...acc.blocks];
          }
          if (s.maxMessageId > acc.maxMessageId) {
            acc.maxMessageId = s.maxMessageId;
          }
          // Apply in-flight tool_call content updates (input_json_delta)
          const updates = (s as unknown as { toolCallUpdates?: Record<string, string> | null }).toolCallUpdates;
          if (updates && Object.keys(updates).length > 0) {
            if (applyToolCallUpdates(acc.blocks, updates)) {
              acc.blocks = [...acc.blocks];
            }
          }
          // Update cached todos if server provided new ones
          if (s.todos != null) {
            acc.todos = s.todos as TodoItem[];
          }
        }
      }
    }

    return serverSessions.map((s) => {
      const acc = accMap.get(s.sessionDbId);

      const status: AgentStatus =
        s.status === "running" || s.status === "paused" || s.status === "completed" || s.status === "error"
          ? s.status
          : s.status === "waiting"
            ? "paused"
            : "idle";

      return {
        sessionDbId: s.sessionDbId,
        agentType: s.agentType as AgentType,
        status,
        subprocessId: s.subprocessId,
        model: s.model,
        blocks: acc?.blocks ?? serverBlocksToAgentBlocks(s.blocks),
        pendingQuestions: parseQuestions(s.pendingQuestions),
        hasFileChanges: s.hasFileChanges,
        resumable: s.resumable,
        claudeSessionId: s.claudeSessionId,
        runId: s.runId,
        phaseId: s.phaseId,
        phaseTitle: s.phaseTitle,
        todos: (s.todos as TodoItem[] | null) ?? acc?.todos ?? null,
        permissionMode: s.permissionMode ?? "acceptEdits",
        pendingPlanApproval: s.pendingPlanApproval ?? null,
        pendingPermission: (s.pendingPermission as PendingPermission | null) ?? null,
        inputTokens: s.inputTokens ?? 0,
        outputTokens: s.outputTokens ?? 0,
        contextWindow: s.contextWindow ?? 200000,
        wasCompacted: s.wasCompacted ?? false,
        draftPrompt: (s as unknown as { draftPrompt?: string | null }).draftPrompt ?? null,
        hasMore: acc?.hasMore ?? s.hasMore ?? false,
        oldestMessageId: acc?.oldestMessageId ?? s.oldestMessageId ?? null,
      };
    });
  }, [query.data, parseQuestions]);

  // After processing new data, bump dataVersion so afterMessageIds recomputes
  // on the next render and subsequent fetches use incremental cursors.
  useEffect(() => {
    if (query.data && query.data.sessions.length > 0) {
      setDataVersion((v) => v + 1);
    }
  }, [query.data]);

  const loadOlderMessages = useCallback(async (sessionDbId: number) => {
    const acc = accumulatedRef.current.get(sessionDbId);
    if (!acc || !acc.hasMore || acc.oldestMessageId == null) return;

    const beforeParam = JSON.stringify({ [sessionDbId]: acc.oldestMessageId });
    const data = await fetchFeatureAgentState(featureId, {
      before: beforeParam,
      limit: OLDER_MESSAGE_LIMIT,
    });

    const serverSession = data.sessions.find((s) => s.sessionDbId === sessionDbId);
    if (!serverSession) return;

    const olderBlocks = serverBlocksToAgentBlocks(serverSession.blocks);
    if (olderBlocks.length === 0) {
      acc.hasMore = false;
      return;
    }

    // Register tool_call blocks from older messages so future merges work
    for (const block of olderBlocks) {
      if (block.type === "tool_call" && block.toolUseId) {
        acc.toolUseIdMap.set(block.toolUseId, { toolName: block.toolName ?? "tool", block });
      }
      if (block.childBlocks) {
        for (const child of block.childBlocks) {
          if (child.type === "tool_call" && child.toolUseId) {
            acc.toolUseIdMap.set(child.toolUseId, { toolName: child.toolName ?? "tool", block: child });
          }
        }
      }
    }

    // Prepend older blocks
    acc.blocks = [...olderBlocks, ...acc.blocks];
    acc.hasMore = serverSession.hasMore ?? false;
    acc.oldestMessageId = serverSession.oldestMessageId ?? null;

    // Force re-render
    setDataVersion((v) => v + 1);
  }, [featureId]);

  return {
    sessions,
    isLoading: query.isLoading,
    refetch: query.refetch,
    loadOlderMessages,
  };
}
