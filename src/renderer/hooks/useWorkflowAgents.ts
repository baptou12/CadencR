import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { trpc } from "@/trpc";
import { useSessionState, useSessionEventListener } from "@/hooks/useSessionState";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType, AgentEvent } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentSession";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseWorkflowAgentsParams {
  featureId: number;
  projectId: number;
  featureQuery: { refetch: () => unknown };
}

/** A single entry in the session list — replaces the old useAgentEntries concept. */
export interface SessionEntry {
  type: AgentType;
  label: string;
  status: AgentStatus;
  blocks: AgentBlockData[];
  subprocessId: string | null;
  pendingQuestions: Array<{
    question: string;
    options?: Array<{ label: string; description?: string }>;
  }>;
  /** Whether this entry can be resumed */
  resumable: boolean;
  /** DB session ID for this entry (used for targeted resume of parallel phases) */
  sessionDbId?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasOutput(state: { status: AgentStatus; blocks: AgentBlockData[] }) {
  return state.status !== "idle" || state.blocks.length > 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkflowAgents({
  featureId,
  projectId,
  featureQuery,
}: UseWorkflowAgentsParams) {
  const [description, setDescription] = useState("");

  // Agent sessions — using the unified useSessionState hook
  const plan = useSessionState({ supportsQuestions: true });
  const brainstorm = useSessionState({ supportsQuestions: true });
  const execute = useSessionState({ supportsMultiSubprocess: true });
  const risk = useSessionState();
  const review = useSessionState();

  // Reset agent states when switching features
  useEffect(() => {
    plan.reset();
    brainstorm.reset();
    execute.reset();
    risk.reset();
    review.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  // Query for running agents (used for reconnection after refresh)
  const runningQuery = trpc.agents.getRunningAgents.useQuery({ featureId });

  // Query for incomplete sessions that can be resumed
  const incompleteQuery = trpc.agents.getIncompleteSessions.useQuery({
    featureId,
  });
  const resumeMutation = trpc.agents.resume.useMutation();

  // Load previous session history for completed agents on mount
  const sessionsQuery = trpc.agents.getSessions.useQuery({
    featureId,
  });

  // Convert stored messages to blocks for display
  const messageToBlock = useCallback(
    (msg: {
      content: string;
      message_type: string;
      tool_name: string | null;
    }): AgentBlockData | null => {
      const id = `hist-${Math.random().toString(36).slice(2)}`;
      switch (msg.message_type) {
        case "text":
          return { id, type: "text", content: msg.content };
        case "text_delta":
          return null; // Skip deltas in history replay (they were appended to text blocks)
        case "tool_call":
          return {
            id,
            type: "tool_call",
            content: msg.content,
            toolName: msg.tool_name ?? "tool",
            toolArgs: msg.content,
          };
        case "tool_result":
        case "tool_error":
          return {
            id,
            type: "tool_result",
            content: msg.content,
            isError: msg.message_type === "tool_error",
          };
        case "user_message":
          return { id, type: "user_message", content: msg.content };
        case "error":
          return { id, type: "text", content: `Error: ${msg.content}` };
        default:
          return null;
      }
    },
    [],
  );

  // Resumable sessions: agentType -> first claudeSessionId (for non-execute agents)
  // and sessionDbId -> claudeSessionId (for targeted resume of specific sessions)
  // Map agent type -> { claudeSessionId, sessionDbId } for the most recent incomplete session.
  // incompleteQuery.data is ordered by id DESC, so the first per type is the most recent.
  const resumableByType = useMemo(() => {
    if (!incompleteQuery.data) return new Map<string, { claudeSessionId: string; sessionDbId: number }>();
    const map = new Map<string, { claudeSessionId: string; sessionDbId: number }>();
    for (const s of incompleteQuery.data) {
      if (!map.has(s.agent_type) && s.claude_session_id) {
        map.set(s.agent_type, { claudeSessionId: s.claude_session_id, sessionDbId: s.id });
      }
    }
    return map;
  }, [incompleteQuery.data]);

  const resumableBySessionId = useMemo(() => {
    if (!incompleteQuery.data) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const s of incompleteQuery.data) {
      if (s.claude_session_id) {
        map.set(s.id, s.claude_session_id);
      }
    }
    return map;
  }, [incompleteQuery.data]);

  // Statuses that indicate a session has usable history worth displaying
  const historyStatuses = new Set(["completed", "error", "paused", "resumed"]);

  // Find last session per agent type for history display
  const lastSessionIds = useMemo(() => {
    if (!sessionsQuery.data) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const s of sessionsQuery.data) {
      if (historyStatuses.has(s.status) && !map.has(s.agent_type)) {
        map.set(s.agent_type, s.id);
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsQuery.data]);

  // For execute: find the latest orchestrator session (run_id IS NULL, agent_type = 'execute')
  // and query its phase sessions via getSessionsByRunId.
  // Note: orchestrator sessions may stay in 'running' status even when all phases are paused,
  // because the orchestrator is a virtual container, not a real subprocess. So we also match 'running'.
  const orchestratorStatuses = new Set([...historyStatuses, "running"]);
  const latestExecuteRunId = useMemo(() => {
    if (!sessionsQuery.data) return null;
    const orchestrator = sessionsQuery.data.find(
      (s) =>
        s.agent_type === "execute" &&
        s.run_id == null &&
        orchestratorStatuses.has(s.status),
    );
    return orchestrator?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsQuery.data]);

  const executeRunQuery = trpc.agents.getSessionsByRunId.useQuery(
    { runId: latestExecuteRunId ?? 0 },
    { enabled: latestExecuteRunId != null },
  );

  const executeSessionIds = useMemo(() => {
    if (!executeRunQuery.data) return [] as number[];
    // Deduplicate by phase_id — keep the latest (highest id) non-resumed session per phase
    const byPhase = new Map<number | null, { sessionId: number; phaseId: number | null }>();
    for (const s of executeRunQuery.data) {
      if (s.status === "resumed") continue; // Skip replaced sessions
      if (!orchestratorStatuses.has(s.status)) continue;
      const key = s.phase_id;
      const existing = byPhase.get(key);
      if (existing == null || s.id > existing.sessionId) {
        byPhase.set(key, { sessionId: s.id, phaseId: s.phase_id });
      }
    }
    // Sort by phase_id to match original execution order (consistent before/after refresh)
    return [...byPhase.values()]
      .toSorted((a, b) => (a.phaseId ?? 0) - (b.phaseId ?? 0))
      .map((v) => v.sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeRunQuery.data]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentStateMap: Record<string, any> = useMemo(
    () => ({ plan, brainstorm, execute, risk, review }),
    [plan, brainstorm, execute, risk, review],
  );

  const planSessionId = lastSessionIds.get("plan");
  const brainstormSessionId = lastSessionIds.get("brainstorm");
  const executeSessionId = lastSessionIds.get("execute");
  const riskSessionId = lastSessionIds.get("risk");
  const reviewSessionId = lastSessionIds.get("review");

  const planHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: planSessionId ?? 0 },
    {
      enabled:
        !!planSessionId && plan.status === "idle" && plan.blocks.length === 0,
    },
  );
  const brainstormHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: brainstormSessionId ?? 0 },
    {
      enabled:
        !!brainstormSessionId &&
        brainstorm.status === "idle" &&
        brainstorm.blocks.length === 0,
    },
  );
  // Only enable the single-session fallback when we're certain there are no phase sessions:
  // either there's no orchestrator (latestExecuteRunId is null), or the run query has
  // loaded and returned nothing. This prevents a race where this fires before
  // executeRunQuery finishes, populates blocks, and blocks the batch path.
  const noPhaseSessionsConfirmed =
    latestExecuteRunId == null ||
    (executeRunQuery.isFetched && executeSessionIds.length === 0);

  const executeHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: executeSessionId ?? 0 },
    {
      enabled:
        !!executeSessionId &&
        noPhaseSessionsConfirmed &&
        execute.status === "idle" &&
        execute.blocks.length === 0,
    },
  );

  // Batch history query for execute phase sessions (linked via run_id)
  const executeBatchHistoryQuery = trpc.agents.getHistoryBatch.useQuery(
    { sessionIds: executeSessionIds },
    {
      enabled:
        executeSessionIds.length > 0 &&
        execute.status === "idle" &&
        execute.blocks.length === 0,
    },
  );
  const riskHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: riskSessionId ?? 0 },
    {
      enabled:
        !!riskSessionId && risk.status === "idle" && risk.blocks.length === 0,
    },
  );
  const reviewHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: reviewSessionId ?? 0 },
    {
      enabled:
        !!reviewSessionId &&
        review.status === "idle" &&
        review.blocks.length === 0,
    },
  );

  const historyQueries = useMemo(
    () => ({
      plan: planHistoryQuery,
      brainstorm: brainstormHistoryQuery,
      execute: executeHistoryQuery,
      risk: riskHistoryQuery,
      review: reviewHistoryQuery,
    }),
    [
      planHistoryQuery,
      brainstormHistoryQuery,
      executeHistoryQuery,
      riskHistoryQuery,
      reviewHistoryQuery,
    ],
  );

  // Helper: merge consecutive text blocks
  const mergeTextBlocks = useCallback((blocks: AgentBlockData[]): AgentBlockData[] => {
    const merged: AgentBlockData[] = [];
    for (const b of blocks) {
      const last = merged[merged.length - 1];
      if (b.type === "text" && last?.type === "text") {
        merged[merged.length - 1] = { ...last, content: last.content + b.content };
      } else {
        merged.push(b);
      }
    }
    return merged;
  }, []);

  // Populate agent blocks from history on mount (non-execute agents)
  useEffect(() => {
    const nonExecuteTypes = ["plan", "brainstorm", "risk", "review"] as const;
    for (const agentType of nonExecuteTypes) {
      const query = historyQueries[agentType];
      const state = agentStateMap[agentType];
      if (!query.data || query.data.length === 0) continue;
      if (state.status !== "idle" || state.blocks.length > 0) continue;

      const blocks: AgentBlockData[] = [];
      for (const msg of query.data) {
        const block = messageToBlock(msg);
        if (block) blocks.push(block);
      }
      if (blocks.length > 0) {
        for (const b of mergeTextBlocks(blocks)) {
          state.appendBlock(b);
        }
        const sourceSession = sessionsQuery.data?.find(s => s.id === lastSessionIds.get(agentType));
        state.setStatus(sourceSession?.status === "paused" ? "paused" : "complete");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    planHistoryQuery.data,
    brainstormHistoryQuery.data,
    riskHistoryQuery.data,
    reviewHistoryQuery.data,
  ]);

  // Populate execute agent blocks from history (handles parallel phases via run_id)
  useEffect(() => {
    if (execute.status !== "idle" || execute.blocks.length > 0) {
      return;
    }

    if (executeSessionIds.length > 0 && executeBatchHistoryQuery.data) {
      // Phase sessions linked via run_id — create a subprocess entry per session
      const batchData = executeBatchHistoryQuery.data;
      let hasAny = false;

      for (const sid of executeSessionIds) {
        const messages = batchData[sid];
        if (!messages || messages.length === 0) continue;

        const blocks: AgentBlockData[] = [];
        for (const msg of messages) {
          const block = messageToBlock(msg);
          if (block) blocks.push(block);
        }
        if (blocks.length === 0) continue;
        hasAny = true;

        const syntheticId = `hist-exec-${sid}`;
        // Determine status for this subprocess from run query data
        const srcSession = executeRunQuery.data?.find((s) => s.id === sid);
        const subStatus: AgentStatus = srcSession?.status === "paused" ? "paused"
          : srcSession?.status === "error" ? "error" : "complete";

        const merged = mergeTextBlocks(blocks);
        // Inject blocks into a subprocess entry (auto-created by appendBlockToSubprocess)
        for (const b of merged) {
          execute.appendBlockToSubprocess(syntheticId, b, subStatus, sid);
        }
      }

      if (hasAny) {
        const anyPaused = executeSessionIds.some((sid) => {
          const s = executeRunQuery.data?.find((sess) => sess.id === sid);
          return s?.status === "paused";
        });
        execute.setStatus(anyPaused ? "paused" : "complete");
      }
    } else if (executeSessionIds.length === 0 && executeHistoryQuery.data && executeHistoryQuery.data.length > 0) {
      // No phase sessions found — fall back to orchestrator session history
      const blocks: AgentBlockData[] = [];
      for (const msg of executeHistoryQuery.data) {
        const block = messageToBlock(msg);
        if (block) blocks.push(block);
      }
      if (blocks.length > 0) {
        for (const b of mergeTextBlocks(blocks)) {
          execute.appendBlock(b);
        }
        const sourceSession = sessionsQuery.data?.find(s => s.id === lastSessionIds.get("execute"));
        execute.setStatus(sourceSession?.status === "paused" ? "paused" : "complete");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeHistoryQuery.data, executeBatchHistoryQuery.data, executeSessionIds]);

  // Reconnect to running agents after refresh — restore subprocess IDs and load history
  const runningHistorySessionIds = useMemo(() => {
    if (!runningQuery.data) return [] as number[];
    return runningQuery.data.map((s) => s.id);
  }, [runningQuery.data]);

  const runningHistoryBatch = trpc.agents.getHistoryBatch.useQuery(
    { sessionIds: runningHistorySessionIds },
    { enabled: runningHistorySessionIds.length > 0 },
  );

  useEffect(() => {
    if (!runningQuery.data || runningQuery.data.length === 0) return;

    for (const session of runningQuery.data) {
      if (!session.subprocess_id) continue;

      // Load history for this running session
      const historyMessages = runningHistoryBatch.data?.[session.id];
      const historyBlocks: AgentBlockData[] = [];
      if (historyMessages) {
        for (const msg of historyMessages) {
          const block = messageToBlock(msg);
          if (block) historyBlocks.push(block);
        }
      }

      if (session.agent_type === "execute") {
        // For execute (multi-subprocess), set up a subprocess entry with history
        if (execute.subprocessList.some((s) => s.subprocessId === session.subprocess_id)) continue;
        for (const b of mergeTextBlocks(historyBlocks)) {
          execute.appendBlockToSubprocess(session.subprocess_id, b, "running", session.id);
        }
        if (historyBlocks.length === 0) {
          execute.appendBlockToSubprocess(
            session.subprocess_id,
            { type: "text", content: "" },
            "running",
            session.id,
          );
        }
        execute.setStatus("running");
      } else {
        const state = agentStateMap[session.agent_type];
        if (!state) continue;
        // Only reconnect if the agent isn't already tracked
        if (state.subprocessIdRef?.current) continue;

        // Load history blocks before tracking (so UI has prior output)
        if (historyBlocks.length > 0) {
          for (const b of mergeTextBlocks(historyBlocks)) {
            state.appendBlock(b);
          }
        }
        state.trackSubprocess(session.subprocess_id, session.id);
        state.setStatus("running");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningQuery.data, runningHistoryBatch.data]);

  const handleResume = useCallback(
    async (agentType: AgentType, targetSessionDbId?: number) => {
      let claudeSessionId: string | undefined;
      let originalSession: (typeof incompleteQuery.data extends (infer T)[] | undefined ? T : never) | undefined;

      if (targetSessionDbId != null) {
        // Targeted resume of a specific session (parallel execute phases)
        claudeSessionId = resumableBySessionId.get(targetSessionDbId);
        originalSession = incompleteQuery.data?.find((s) => s.id === targetSessionDbId);
      } else {
        // Generic resume by agent type — uses the most recent incomplete session
        const resumable = resumableByType.get(agentType);
        claudeSessionId = resumable?.claudeSessionId;
        originalSession = incompleteQuery.data?.find((s) => s.id === resumable?.sessionDbId);
      }

      if (!claudeSessionId || !originalSession) return;

      const state = agentStateMap[agentType];
      // Don't call state.start() — it clears all blocks/subprocesses.
      // Just set status to running to preserve existing history.
      state.setStatus("running");

      try {
        const result = await resumeMutation.mutateAsync({
          featureId,
          projectId,
          agentType,
          sessionId: claudeSessionId,
          originalSessionDbId: originalSession.id,
        });

        // For multi-subprocess execute agents, remap the history panel
        // (keyed by synthetic ID) to the new real subprocess ID so events
        // flow into the existing panel instead of creating a new one.
        if (agentType === "execute") {
          const syntheticId = `hist-exec-${originalSession.id}`;
          execute.remapSubprocess(syntheticId, result.subprocessId);
        } else {
          state.trackSubprocess(result.subprocessId);
        }
        void incompleteQuery.refetch();
        void runningQuery.refetch();
      } catch (err) {
        state.setStatus("error");
        state.appendBlock({
          type: "text",
          content: `Failed to resume: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      resumableByType,
      resumableBySessionId,
      incompleteQuery,
      featureId,
      projectId,
      plan,
      brainstorm,
      execute,
      risk,
      review,
      resumeMutation,
    ],
  );

  // --- Continue build state (Level 2 autonomy: manual continue) ---
  const [executeWaitingSessionDbId, setExecuteWaitingSessionDbId] = useState<number | null>(null);
  const [executeWaitingNextStep, setExecuteWaitingNextStep] = useState<number | null>(null);
  const continueExecuteMutation = trpc.agents.continueExecute.useMutation();

  // Detect waiting orchestrator on mount (page refresh scenario)
  useEffect(() => {
    if (!sessionsQuery.data) return;
    const waitingOrchestrator = sessionsQuery.data.find(
      (s) => s.agent_type === "execute" && s.run_id == null && s.status === "waiting",
    );
    if (waitingOrchestrator) {
      setExecuteWaitingSessionDbId(waitingOrchestrator.id);
      // We don't have nextStepNumber persisted, so use a generic label
      // The execute_waiting event at runtime will have the real number
      setExecuteWaitingNextStep(null);
    }
  }, [sessionsQuery.data]);

  const handleContinueBuild = useCallback(async () => {
    if (executeWaitingSessionDbId == null) return;
    const sessionDbId = executeWaitingSessionDbId;
    setExecuteWaitingSessionDbId(null);
    setExecuteWaitingNextStep(null);
    execute.setStatus("running");
    try {
      await continueExecuteMutation.mutateAsync({ sessionDbId });
    } catch (err) {
      execute.setStatus("error");
      execute.appendBlock({
        type: "text",
        content: `Failed to continue build: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [executeWaitingSessionDbId, continueExecuteMutation, execute]);

  const canContinueBuild = executeWaitingSessionDbId != null;
  const isContinuingBuild = continueExecuteMutation.isLoading;

  // Wrap execute handleEvent to intercept execute_waiting events
  const originalExecuteHandleEvent = execute.handleEvent;
  const executeHandleEventRef = useRef(originalExecuteHandleEvent);
  executeHandleEventRef.current = originalExecuteHandleEvent;

  const wrappedExecuteHandleEvent = useCallback(
    (agentEvent: AgentEvent) => {
      if (agentEvent.event.type === "execute_waiting") {
        const evt = agentEvent.event as { type: "execute_waiting"; nextStepNumber: number };
        // Extract sessionDbId from subprocessId "session-{id}"
        const match = agentEvent.subprocessId.match(/^session-(\d+)$/);
        const sessionDbId = match ? Number(match[1]) : null;
        if (sessionDbId != null) {
          setExecuteWaitingSessionDbId(sessionDbId);
          setExecuteWaitingNextStep(evt.nextStepNumber);
          execute.setStatus("paused");
        }
        return;
      }
      executeHandleEventRef.current(agentEvent);
    },
    [execute],
  );

  const [reviewComplete, setReviewComplete] = useState(false);
  const [reviewVerdict, setReviewVerdict] = useState<
    "approved" | "changes_requested" | null
  >(null);

  // Mutations
  const startPlanMutation = trpc.agents.startPlan.useMutation();
  const startBrainstormMutation = trpc.agents.startBrainstorm.useMutation();
  const startExecuteMutation = trpc.agents.startExecute.useMutation();
  const startRiskMutation = trpc.agents.startRisk.useMutation();
  const startReviewMutation = trpc.agents.startReview.useMutation();
  const addFixPhaseMutation = trpc.agents.addFixPhase.useMutation();
  const startExecuteForFixMutation = trpc.agents.startExecute.useMutation();
  const submitAnswersMutation = trpc.agents.submitAnswers.useMutation();
  const stopMutation = trpc.agents.stop.useMutation();
  const stopBySessionIdMutation = trpc.agents.stopBySessionId.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const interruptBySessionIdMutation = trpc.agents.interruptBySessionId.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();

  // Wire up IPC event listener using the unified useSessionEventListener
  const eventHandlers = useMemo(
    () => ({
      plan: {
        handleEvent: plan.handleEvent,
        subprocessIdRef: plan.subprocessIdRef,
        sessionDbIdRef: plan.sessionDbIdRef,
      },
      brainstorm: {
        handleEvent: brainstorm.handleEvent,
        subprocessIdRef: brainstorm.subprocessIdRef,
        sessionDbIdRef: brainstorm.sessionDbIdRef,
      },
      execute: { handleEvent: wrappedExecuteHandleEvent },
      risk: {
        handleEvent: risk.handleEvent,
        sessionDbIdRef: risk.sessionDbIdRef,
      },
      review: {
        handleEvent: review.handleEvent,
        sessionDbIdRef: review.sessionDbIdRef,
      },
    }),
    [
      plan.handleEvent,
      plan.subprocessIdRef,
      plan.sessionDbIdRef,
      brainstorm.handleEvent,
      brainstorm.subprocessIdRef,
      brainstorm.sessionDbIdRef,
      wrappedExecuteHandleEvent,
      risk.handleEvent,
      risk.sessionDbIdRef,
      review.handleEvent,
      review.sessionDbIdRef,
    ],
  );
  useSessionEventListener(eventHandlers);

  // Action handlers
  const handleStartPlanning = async () => {
    if (!description.trim()) return;
    plan.start();
    try {
      const result = await startPlanMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      plan.trackSubprocess(result.subprocessId);
    } catch (err) {
      plan.setStatus("error");
      plan.appendBlock({
        type: "text",
        content: `Failed to start plan agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleStartBrainstorming = async () => {
    if (!description.trim()) return;
    brainstorm.start();
    try {
      const result = await startBrainstormMutation.mutateAsync({
        featureId,
        projectId,
        description: description.trim(),
      });
      brainstorm.trackSubprocess(result.subprocessId);
    } catch (err) {
      brainstorm.setStatus("error");
      brainstorm.appendBlock({
        type: "text",
        content: `Failed to start brainstorm agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleQuestionResponse = (response: string) => {
    if (!plan.subprocessId || plan.pendingQuestions.length === 0) return;

    const answers: Record<string, string> = {};
    const sections = response.split("\n\n");

    plan.pendingQuestions.forEach((q, index) => {
      const section = sections[index];
      if (section) {
        const answerMatch = section.match(/Answer:\s*(.+)/s);
        if (answerMatch) {
          answers[q.question] = answerMatch[1].trim();
        }
      }
    });

    submitAnswersMutation.mutate({
      subprocessId: plan.subprocessId,
      answers,
    });

    plan.clearQuestions();
  };

  const handleBrainstormQuestionResponse = (response: string) => {
    if (!brainstorm.subprocessId || brainstorm.pendingQuestions.length === 0)
      return;

    const answers: Record<string, string> = {};
    const sections = response.split("\n\n");

    brainstorm.pendingQuestions.forEach((q, index) => {
      const section = sections[index];
      if (section) {
        const answerMatch = section.match(/Answer:\s*(.+)/s);
        if (answerMatch) {
          answers[q.question] = answerMatch[1].trim();
        }
      }
    });

    submitAnswersMutation.mutate({
      subprocessId: brainstorm.subprocessId,
      answers,
    });

    brainstorm.clearQuestions();
  };

  const handleStartBuilding = async () => {
    execute.start();
    try {
      await startExecuteMutation.mutateAsync({
        featureId,
        projectId,
      });
    } catch (err) {
      execute.setStatus("error");
      execute.appendBlock({
        type: "text",
        content: `Failed to start execute agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleStartRisk = async () => {
    risk.start();
    try {
      await startRiskMutation.mutateAsync({
        featureId,
        projectId,
      });
    } catch (err) {
      risk.setStatus("error");
      risk.appendBlock({
        type: "text",
        content: `Failed to start risk agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleStartReview = async () => {
    review.start();
    setReviewComplete(false);
    setReviewVerdict(null);
    try {
      await startReviewMutation.mutateAsync({
        featureId,
        projectId,
      });
    } catch (err) {
      review.setStatus("error");
      review.appendBlock({
        type: "text",
        content: `Failed to start review agent: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleAddFixPhase = async () => {
    const reviewText = review.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.content)
      .join("\n");
    try {
      await addFixPhaseMutation.mutateAsync({
        featureId,
        fixDescription: `Fix the following issues identified during code review:\n\n${reviewText}`,
      });
      review.appendBlock({
        type: "text",
        content:
          "\n\n--- Fix phase added to plan. You can execute it from the Build step. ---",
      });
    } catch (err) {
      review.appendBlock({
        type: "text",
        content: `Failed to add fix phase: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const handleFixImmediately = async () => {
    execute.start();
    try {
      await startExecuteForFixMutation.mutateAsync({
        featureId,
        projectId,
      });
    } catch (err) {
      execute.setStatus("error");
      execute.appendBlock({
        type: "text",
        content: `Failed to start fix execution: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // Detect review completion and verdict
  useEffect(() => {
    if (review.status !== "running") return;
    const fullText = review.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.content)
      .join("");
    if (fullText.includes("---REVIEW_APPROVED---")) {
      setReviewComplete(true);
      setReviewVerdict("approved");
      review.setStatus("complete");
      void featureQuery.refetch();
    } else if (fullText.includes("---REVIEW_CHANGES_REQUESTED---")) {
      setReviewComplete(true);
      setReviewVerdict("changes_requested");
      review.setStatus("complete");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.blocks, review.status, review.setStatus, featureQuery]);

  // Per-agent send message handler
  const handleAgentSend = useCallback(
    (agentType: AgentType, message: string) => {
      const state = agentStateMap[agentType];
      const id = state.subprocessId;
      if (!id) return;
      state.appendBlock({ type: "user_message", content: message });
      sendMessageMutation.mutate({ id, message });
    },
    [agentStateMap, sendMessageMutation],
  );

  // Per-agent stop handler (non-execute agents — execute uses per-panel interrupt)
  const handleAgentStop = useCallback(
    async (agentType: AgentType) => {
      const state = agentStateMap[agentType];
      const id = state.subprocessId;
      try {
        if (id) {
          await stopMutation.mutateAsync({ id });
        } else if (state.sessionDbId) {
          // Fallback: stop by DB session ID (works after refresh when subprocess ID is lost)
          await stopBySessionIdMutation.mutateAsync({ sessionId: state.sessionDbId });
        } else {
          return;
        }
      } catch {
        // best effort
      }
      state.setStatus("paused");
      state.appendBlock({
        type: "text",
        content: "\n\nStopped. This agent can be resumed.",
      });
      void incompleteQuery.refetch();
    },
    [agentStateMap, stopMutation, stopBySessionIdMutation, incompleteQuery],
  );

  // Convenience wrappers for execute subprocess operations
  const sendToExecuteSubprocess = useCallback(
    (subprocessId: string, message: string) => {
      sendMessageMutation.mutate({ id: subprocessId, message });
      execute.appendBlockToSubprocess(subprocessId, { type: "user_message", content: message });
    },
    [sendMessageMutation, execute],
  );

  const interruptExecuteSubprocess = useCallback(
    async (subprocessId: string, sessionDbId?: number) => {
      try {
        await interruptMutation.mutateAsync({ id: subprocessId });
      } catch {
        // Fallback to session-based interrupt if subprocess ID is stale
        if (sessionDbId != null) {
          await interruptBySessionIdMutation.mutateAsync({ sessionId: sessionDbId }).catch(() => {});
        }
      }
    },
    [interruptMutation, interruptBySessionIdMutation],
  );

  // ---------------------------------------------------------------------------
  // Session entry list — the unified model that replaces useAgentEntries
  // ---------------------------------------------------------------------------

  const sessionEntries: SessionEntry[] = useMemo(() => {
    const entries: SessionEntry[] = [];

    // Planning agents
    if (hasOutput(plan)) {
      entries.push({
        type: "plan",
        label: "Plan",
        status: plan.status,
        blocks: plan.blocks,
        subprocessId: plan.subprocessId,
        pendingQuestions: plan.pendingQuestions,
        resumable: resumableByType.has("plan"),
        sessionDbId: resumableByType.get("plan")?.sessionDbId,
      });
    }
    if (hasOutput(brainstorm)) {
      entries.push({
        type: "brainstorm",
        label: "Brainstorm",
        status: brainstorm.status,
        blocks: brainstorm.blocks,
        subprocessId: brainstorm.subprocessId,
        pendingQuestions: brainstorm.pendingQuestions,
        resumable: resumableByType.has("brainstorm"),
        sessionDbId: resumableByType.get("brainstorm")?.sessionDbId,
      });
    }

    // Build phase agents — expand parallel execute subprocesses into separate entries
    const execSubs = execute.subprocessList.filter(
      (s) => s.subprocessId !== "__global__",
    );
    if (execSubs.length > 1) {
      // Multiple parallel phases — one entry per subprocess
      for (let i = 0; i < execSubs.length; i++) {
        const sub = execSubs[i];
        entries.push({
          type: "execute",
          label: `Execute ${i + 1}`,
          status: sub.status,
          blocks: sub.blocks,
          subprocessId: sub.subprocessId,
          pendingQuestions: [],
          resumable: sub.sessionDbId != null && resumableBySessionId.has(sub.sessionDbId),
          sessionDbId: sub.sessionDbId,
        });
      }
    } else if (hasOutput(execute)) {
      // Single phase or merged view
      entries.push({
        type: "execute",
        label: "Execute",
        status: execute.status,
        blocks: execute.blocks,
        subprocessId: execute.subprocessId,
        pendingQuestions: [],
        resumable: resumableByType.has("execute"),
        sessionDbId: resumableByType.get("execute")?.sessionDbId,
      });
    }

    // Append global blocks (e.g. error messages) if any
    const globalSub = execute.subprocessList.find(
      (s) => s.subprocessId === "__global__",
    );
    if (globalSub && globalSub.blocks.length > 0 && execSubs.length > 1) {
      entries.push({
        type: "execute",
        label: "Execute",
        status: execute.status,
        blocks: globalSub.blocks,
        subprocessId: null,
        pendingQuestions: [],
        resumable: false,
      });
    }

    if (hasOutput(risk)) {
      entries.push({
        type: "risk",
        label: "Risk Analysis",
        status: risk.status,
        blocks: risk.blocks,
        subprocessId: risk.subprocessId,
        pendingQuestions: [],
        resumable: resumableByType.has("risk"),
        sessionDbId: resumableByType.get("risk")?.sessionDbId,
      });
    }
    if (hasOutput(review)) {
      entries.push({
        type: "review",
        label: "Review",
        status: review.status,
        blocks: review.blocks,
        subprocessId: review.subprocessId,
        pendingQuestions: [],
        resumable: resumableByType.has("review"),
        sessionDbId: resumableByType.get("review")?.sessionDbId,
      });
    }

    return entries;
  }, [plan, brainstorm, execute, risk, review, resumableByType, resumableBySessionId]);

  // Derived state from the session list
  const hasAnyAgentOutput = sessionEntries.length > 0;
  const noAgentsRunning = useMemo(
    () =>
      [plan, brainstorm, execute, risk, review].every(
        (s) => s.status !== "running",
      ),
    [plan, brainstorm, execute, risk, review],
  );

  // Track which agent panel is open (auto-opens running agents)
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  useEffect(() => {
    const running = sessionEntries.find((e) => e.status === "running");
    if (running) {
      setOpenAgent(running.label);
    }
  }, [sessionEntries]);

  return {
    description,
    setDescription,
    plan,
    brainstorm,
    execute,
    risk,
    review,
    resumableByType,
    reviewComplete,
    reviewVerdict,
    isStartingPlan: startPlanMutation.isLoading,
    isStartingBrainstorm: startBrainstormMutation.isLoading,
    isStartingExecute: startExecuteMutation.isLoading,
    isStartingRisk: startRiskMutation.isLoading,
    isStartingReview: startReviewMutation.isLoading,
    isAddingFixPhase: addFixPhaseMutation.isLoading,
    isStartingFix: startExecuteForFixMutation.isLoading,
    handleStartPlanning,
    handleStartBrainstorming,
    handleQuestionResponse,
    handleBrainstormQuestionResponse,
    handleStartBuilding,
    handleStartRisk,
    handleStartReview,
    handleAddFixPhase,
    handleFixImmediately,
    handleResume,
    handleAgentSend,
    handleAgentStop,
    sendToExecuteSubprocess,
    interruptExecuteSubprocess,
    // Continue build (Level 2 autonomy)
    canContinueBuild,
    executeWaitingNextStep,
    handleContinueBuild,
    isContinuingBuild,
    // Session list model (replaces useAgentEntries)
    sessionEntries,
    hasAnyAgentOutput,
    noAgentsRunning,
    openAgent,
    setOpenAgent,
  };
}
