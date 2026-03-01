/**
 * Single hook that provides all agent state for a feature.
 *
 * Data flows through a single path:
 *   1. `trpc.sessions.getFeatureAgentState` — canonical state from DB (pre-built nested blocks)
 *   2. `useDbUpdated` invalidates the query on throttled `db:updated` events from main process
 *   3. Terminal events (agent_done, agent_paused) trigger an immediate refetch
 */

import { useEffect, useRef, useCallback } from "react";
import { trpc } from "@/trpc";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentEvent, AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentSession";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";

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
  createdAt?: string;
  model?: string;
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
    createdAt: sb.createdAt,
    model: sb.model,
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
  draftPrompt: string | null;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export function useFeatureAgentState(featureId: number) {
  const query = trpc.sessions.getFeatureAgentState.useQuery({ featureId });

  // Stable ref to query.refetch so the IPC effect doesn't re-register every render
  const refetchRef = useRef(query.refetch);
  refetchRef.current = query.refetch;

  // Listen for terminal events (agent_done, agent_paused) to trigger immediate refetch
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
      const e = agentEvent.event;

      // Only handle terminal events — stream events are now delivered via DB + throttled notify
      if (
        e.type === "agent_done" ||
        e.type === "agent_paused" ||
        e.type === "result" ||
        e.type === "error"
      ) {
        void refetchRef.current();
      }
    });

    return () => {
      api.offAgentEvent(listener as undefined);
    };
  }, [featureId]);

  // Parse question helper — handles both {questions: [...]} and {question: "..."} formats
  const parseQuestions = useCallback((raw: unknown): AgentQuestion[] | null => {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const questions: AgentQuestion[] = [];

    const normalizeOptions = (opts: unknown): AgentQuestion["options"] => {
      if (!Array.isArray(opts)) return [];
      return opts.map((opt) => {
        if (typeof opt === "string") return { label: opt };
        if (opt && typeof opt === "object" && "label" in opt) {
          const o = opt as { label: string; description?: string };
          return { label: o.label, description: o.description };
        }
        return { label: String(opt) };
      });
    };

    // Multi-question format: {questions: [{question, options}, ...]}
    if (Array.isArray(obj.questions)) {
      for (const q of obj.questions) {
        const qObj = q as { question: string; options?: unknown[] };
        questions.push({
          question: qObj.question,
          options: normalizeOptions(qObj.options),
        });
      }
    }
    // Single question format: {question: "...", options: [...]}
    else if (typeof obj.question === "string") {
      questions.push({
        question: obj.question as string,
        options: normalizeOptions(obj.options),
      });
    }

    return questions.length > 0 ? questions : null;
  }, []);

  // Map server data directly to FeatureSession — no merge step needed
  const sessions: FeatureSession[] = (query.data?.sessions ?? []).map((s) => {
    const blocks = serverBlocksToAgentBlocks(s.blocks as ServerBlock[]);

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
      blocks,
      pendingQuestions: parseQuestions(s.pendingQuestions),
      hasFileChanges: s.hasFileChanges,
      resumable: s.resumable,
      claudeSessionId: s.claudeSessionId,
      runId: s.runId,
      phaseId: s.phaseId,
      phaseTitle: s.phaseTitle,
      todos: (s.todos as TodoItem[] | null) ?? null,
      permissionMode: s.permissionMode ?? "acceptEdits",
      pendingPlanApproval: s.pendingPlanApproval ?? null,
      pendingPermission: s.pendingPermission ?? null,
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
      contextWindow: s.contextWindow ?? 200000,
      wasCompacted: s.wasCompacted ?? false,
      draftPrompt: (s as unknown as { draftPrompt?: string | null }).draftPrompt ?? null,
    };
  });

  return {
    sessions,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
