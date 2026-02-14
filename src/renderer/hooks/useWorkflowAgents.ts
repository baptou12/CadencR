import { useState, useEffect, useMemo, useCallback } from "react";
import { trpc } from "@/trpc";
import { useSessionState, useSessionEventListener } from "@/hooks/useSessionState";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType } from "../../main/agents/types";
import type { AgentStatus } from "@/components/AgentPanel";

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

  // Resumable sessions map: agentType -> claudeSessionId
  const resumableSessions = useMemo(() => {
    if (!incompleteQuery.data) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const s of incompleteQuery.data) {
      if (!map.has(s.agent_type)) {
        map.set(s.agent_type, s.claude_session_id!);
      }
    }
    return map;
  }, [incompleteQuery.data]);

  // Find last completed session per agent type for history display
  const lastSessionIds = useMemo(() => {
    if (!sessionsQuery.data) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const s of sessionsQuery.data) {
      if (
        (s.status === "completed" || s.status === "error") &&
        !map.has(s.agent_type)
      ) {
        map.set(s.agent_type, s.id);
      }
    }
    return map;
  }, [sessionsQuery.data]);

  // Load history for all agent types
  const agentTypes = [
    "plan",
    "brainstorm",
    "execute",
    "risk",
    "review",
  ] as const;
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
  const executeHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: executeSessionId ?? 0 },
    {
      enabled:
        !!executeSessionId &&
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

  // Populate agent blocks from history on mount
  useEffect(() => {
    for (const agentType of agentTypes) {
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
        // Merge consecutive text blocks
        const merged: AgentBlockData[] = [];
        for (const b of blocks) {
          const last = merged[merged.length - 1];
          if (b.type === "text" && last?.type === "text") {
            merged[merged.length - 1] = {
              ...last,
              content: last.content + b.content,
            };
          } else {
            merged.push(b);
          }
        }
        for (const b of merged) {
          state.appendBlock(b);
        }
        state.setStatus("complete");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    planHistoryQuery.data,
    brainstormHistoryQuery.data,
    executeHistoryQuery.data,
    riskHistoryQuery.data,
    reviewHistoryQuery.data,
  ]);

  const handleResume = useCallback(
    async (agentType: AgentType) => {
      const claudeSessionId = resumableSessions.get(agentType);
      if (!claudeSessionId) return;

      const state = agentStateMap[agentType];
      state.start();

      try {
        const result = await resumeMutation.mutateAsync({
          cwd: ".",
          agentType,
          sessionId: claudeSessionId,
        });
        state.trackSubprocess(result.id);
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
      resumableSessions,
      plan,
      brainstorm,
      execute,
      risk,
      review,
      resumeMutation,
    ],
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
  const interruptMutation = trpc.agents.interrupt.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();

  // Wire up IPC event listener using the unified useSessionEventListener
  const eventHandlers = useMemo(
    () => ({
      plan: {
        handleEvent: plan.handleEvent,
        subprocessIdRef: plan.subprocessIdRef,
      },
      brainstorm: {
        handleEvent: brainstorm.handleEvent,
        subprocessIdRef: brainstorm.subprocessIdRef,
      },
      execute: { handleEvent: execute.handleEvent },
      risk: { handleEvent: risk.handleEvent },
      review: { handleEvent: review.handleEvent },
    }),
    [
      plan.handleEvent,
      plan.subprocessIdRef,
      brainstorm.handleEvent,
      brainstorm.subprocessIdRef,
      execute.handleEvent,
      risk.handleEvent,
      review.handleEvent,
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
      if (!id) return;
      try {
        await stopMutation.mutateAsync({ id });
      } catch {
        // best effort
      }
      state.setStatus("error");
      state.appendBlock({
        type: "text",
        content: "\n\nStopped by user.",
      });
    },
    [agentStateMap, stopMutation],
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
    async (subprocessId: string) => {
      await interruptMutation.mutateAsync({ id: subprocessId }).catch(() => {});
    },
    [interruptMutation],
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
        resumable: resumableSessions.has("plan"),
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
        resumable: resumableSessions.has("brainstorm"),
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
          resumable: false,
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
        resumable: false,
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
        resumable: false,
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
        resumable: false,
      });
    }

    return entries;
  }, [plan, brainstorm, execute, risk, review, resumableSessions]);

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
    resumableSessions,
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
    // Session list model (replaces useAgentEntries)
    sessionEntries,
    hasAnyAgentOutput,
    noAgentsRunning,
    openAgent,
    setOpenAgent,
  };
}
