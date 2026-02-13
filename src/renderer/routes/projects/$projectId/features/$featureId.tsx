import { useState, useEffect, useMemo, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentPanel, type AgentStatus } from "@/components/AgentPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc";
import {
  Loader2Icon,
  PlusCircleIcon,
  WrenchIcon,
  CheckCircle2Icon,
  PlayIcon,
} from "lucide-react";
import { useAgentState, useAgentEventListener } from "@/hooks/useAgentState";
import { useMultiExecuteState } from "@/hooks/useMultiExecuteState";
import { useFeatureState, type FeatureStatus } from "@/hooks/useFeatureState";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType } from "../../../../../main/agents/types";
import { PlanSidebar } from "@/components/PlanSidebar";
import { AGENT_ICONS } from "@/components/agent-icons";
import { AgentStream } from "@/components/AgentStream";
import { AgentPromptBar } from "@/components/AgentPromptBar";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

// ---------------------------------------------------------------------------
// SessionView — simplified layout for free-form Claude sessions
// ---------------------------------------------------------------------------

function SessionView({
  featureId,
  projectId,
  title,
}: {
  featureId: number;
  projectId: number;
  title: string;
}) {
  const session = useAgentState();

  // Check for incomplete (resumable) sessions
  const incompleteQuery = trpc.agents.getIncompleteSessions.useQuery({
    featureId,
  });
  const sessionsQuery = trpc.agents.getSessions.useQuery({ featureId });

  const resumableSessionId = useMemo(() => {
    if (!incompleteQuery.data) return null;
    const s = incompleteQuery.data.find((r) => r.agent_type === "session");
    return s?.claude_session_id ?? null;
  }, [incompleteQuery.data]);

  // Find last completed session for history
  const lastSessionDbId = useMemo(() => {
    if (!sessionsQuery.data) return null;
    const s = sessionsQuery.data.find(
      (r) =>
        r.agent_type === "session" &&
        (r.status === "completed" || r.status === "error"),
    );
    return s?.id ?? null;
  }, [sessionsQuery.data]);

  const historyQuery = trpc.agents.getHistory.useQuery(
    { sessionId: lastSessionDbId ?? 0 },
    {
      enabled:
        !!lastSessionDbId &&
        session.status === "idle" &&
        session.blocks.length === 0,
    },
  );

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
          return null;
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

  // Populate blocks from history on mount
  useEffect(() => {
    if (!historyQuery.data || historyQuery.data.length === 0) return;
    if (session.status !== "idle" || session.blocks.length > 0) return;

    const blocks: AgentBlockData[] = [];
    for (const msg of historyQuery.data) {
      const block = messageToBlock(msg);
      if (block) blocks.push(block);
    }
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
      session.appendBlock(b);
    }
    session.setStatus("complete");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQuery.data]);

  // Event listener for session agent
  const eventHandlers = useMemo(
    () => ({
      session: {
        handleEvent: session.handleEvent,
        subprocessIdRef: session.subprocessIdRef,
      },
    }),
    [session.handleEvent, session.subprocessIdRef],
  );
  useAgentEventListener(eventHandlers);

  // Mutations
  const startSessionMutation = trpc.agents.startSession.useMutation();
  const resumeMutation = trpc.agents.resume.useMutation();
  const sendMessageMutation = trpc.agents.sendMessage.useMutation();
  const interruptMutation = trpc.agents.interrupt.useMutation();

  const handleSend = useCallback(
    async (message: string) => {
      if (session.status === "running" && session.subprocessId) {
        // Follow-up message to running session
        session.appendBlock({ type: "user_message", content: message });
        sendMessageMutation.mutate({ id: session.subprocessId, message });
        return;
      }

      if (session.status === "paused" && session.subprocessId) {
        // Resume paused session with a message
        session.appendBlock({ type: "user_message", content: message });
        sendMessageMutation.mutate({ id: session.subprocessId, message });
        session.setStatus("running");
        return;
      }

      // Start a new session
      session.start();
      session.appendBlock({ type: "user_message", content: message });
      try {
        const result = await startSessionMutation.mutateAsync({
          featureId,
          projectId,
          prompt: message,
        });
        session.trackSubprocess(result.subprocessId);
      } catch (err) {
        session.setStatus("error");
        session.appendBlock({
          type: "text",
          content: `Failed to start session: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      session.status,
      session.subprocessId,
      featureId,
      projectId,
      sendMessageMutation,
      startSessionMutation,
    ],
  );

  const handleStop = useCallback(async () => {
    if (!session.subprocessId) return;
    try {
      await interruptMutation.mutateAsync({ id: session.subprocessId });
    } catch {
      // best effort
    }
  }, [session.subprocessId, interruptMutation]);

  const handleResume = useCallback(async () => {
    if (!resumableSessionId) return;
    session.start();
    try {
      const result = await resumeMutation.mutateAsync({
        cwd: ".",
        agentType: "session" as AgentType,
        sessionId: resumableSessionId,
      });
      session.trackSubprocess(result.id);
    } catch (err) {
      session.setStatus("error");
      session.appendBlock({
        type: "text",
        content: `Failed to resume: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumableSessionId, resumeMutation]);

  const isIdle = session.status === "idle" && session.blocks.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <AGENT_ICONS.session className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">{title}</h1>
        {session.status === "running" && (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Scrollable agent output */}
      <div className="flex-1 overflow-auto p-4">
        {isIdle && !resumableSessionId && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Send a message to start a session with Claude Code.
            </p>
          </div>
        )}
        {isIdle && resumableSessionId && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-sm text-muted-foreground">
              You have an incomplete session that can be resumed.
            </p>
            <Button variant="outline" size="sm" onClick={handleResume}>
              <PlayIcon className="mr-2 size-4" />
              Resume Session
            </Button>
          </div>
        )}
        {session.blocks.length > 0 && (
          <AgentStream
            blocks={session.blocks}
            isStreaming={session.status === "running"}
          />
        )}
      </div>

      {/* Prompt bar pinned at bottom */}
      <AgentPromptBar
        onSend={handleSend}
        onStop={handleStop}
        status={session.status}
        disabled={startSessionMutation.isLoading}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FeaturePage — routes to SessionView or FeatureWorkflowView
// ---------------------------------------------------------------------------

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = trpc.features.getById.useQuery({
    id: numericFeatureId,
  });
  const feature = featureQuery.data;

  if (feature?.type === "session") {
    return (
      <SessionView
        featureId={numericFeatureId}
        projectId={numericProjectId}
        title={feature.title}
      />
    );
  }

  return (
    <FeatureWorkflowView
      featureId={numericFeatureId}
      projectId={numericProjectId}
      feature={feature}
      featureQuery={featureQuery}
    />
  );
}

// ---------------------------------------------------------------------------
// FeatureWorkflowView — the existing structured feature workflow
// ---------------------------------------------------------------------------

function FeatureWorkflowView({
  featureId: numericFeatureId,
  projectId: numericProjectId,
  feature,
  featureQuery,
}: {
  featureId: number;
  projectId: number;
  feature: { id: number; title: string; status: string; type: string; project_id: number; created_at: string } | undefined;
  featureQuery: { refetch: () => unknown };
}) {
  const [description, setDescription] = useState("");
  // Agent states
  const plan = useAgentState({ supportsQuestions: true });
  const brainstorm = useAgentState({ supportsQuestions: true });
  const execute = useMultiExecuteState();
  const risk = useAgentState();
  const review = useAgentState();

  // Reset agent states when switching features
  useEffect(() => {
    plan.reset();
    brainstorm.reset();
    execute.reset();
    risk.reset();
    review.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericFeatureId]);

  // Query for incomplete sessions that can be resumed
  const incompleteQuery = trpc.agents.getIncompleteSessions.useQuery({
    featureId: numericFeatureId,
  });
  const resumeMutation = trpc.agents.resume.useMutation();

  // Load previous session history for completed agents on mount
  const sessionsQuery = trpc.agents.getSessions.useQuery({
    featureId: numericFeatureId,
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

  // Wrap execute event handler to ignore per-subprocess agent_done events.
  // The execute agent runs multiple subprocesses in parallel; only the
  // session-level "all done" event (subprocessId starts with "session-") should
  // mark execution as complete.
  // Wire up IPC event listener
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
  useAgentEventListener(eventHandlers);

  // Action handlers
  const handleStartPlanning = async () => {
    if (!description.trim()) return;
    plan.start();
    try {
      const result = await startPlanMutation.mutateAsync({
        featureId: numericFeatureId,
        projectId: numericProjectId,
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
        featureId: numericFeatureId,
        projectId: numericProjectId,
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

    // Parse the response to extract answers
    // The AgentQuestionDrawer formats responses as "Question\nAnswer: ...\n\n..."
    const answers: Record<string, string> = {};
    const sections = response.split("\n\n");

    plan.pendingQuestions.forEach((q, index) => {
      // Find the section that contains this question
      const section = sections[index];
      if (section) {
        const answerMatch = section.match(/Answer:\s*(.+)/s);
        if (answerMatch) {
          // Use the question text as the key (Claude expects this format)
          answers[q.question] = answerMatch[1].trim();
        }
      }
    });

    // Submit answers to the main process
    submitAnswersMutation.mutate({
      subprocessId: plan.subprocessId,
      answers,
    });

    // Clear the questions from the UI
    plan.clearQuestions();
  };

  const handleBrainstormQuestionResponse = (response: string) => {
    if (!brainstorm.subprocessId || brainstorm.pendingQuestions.length === 0)
      return;

    // Parse the response to extract answers
    const answers: Record<string, string> = {};
    const sections = response.split("\n\n");

    brainstorm.pendingQuestions.forEach((q, index) => {
      // Find the section that contains this question
      const section = sections[index];
      if (section) {
        const answerMatch = section.match(/Answer:\s*(.+)/s);
        if (answerMatch) {
          // Use the question text as the key
          answers[q.question] = answerMatch[1].trim();
        }
      }
    });

    // Submit answers to the main process
    submitAnswersMutation.mutate({
      subprocessId: brainstorm.subprocessId,
      answers,
    });

    // Clear the questions from the UI
    brainstorm.clearQuestions();
  };

  const handleStartBuilding = async () => {
    execute.start();
    try {
      await startExecuteMutation.mutateAsync({
        featureId: numericFeatureId,
        projectId: numericProjectId,
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
        featureId: numericFeatureId,
        projectId: numericProjectId,
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
        featureId: numericFeatureId,
        projectId: numericProjectId,
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
        featureId: numericFeatureId,
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
        featureId: numericFeatureId,
        projectId: numericProjectId,
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

  // Collect all running agents for the stop button
  const allAgents = useMemo(
    () => [
      { state: plan, label: "Plan" },
      { state: brainstorm, label: "Brainstorm" },
      { state: execute, label: "Execute" },
      { state: risk, label: "Risk" },
      { state: review, label: "Review" },
    ],
    [plan, brainstorm, execute, risk, review],
  );

  const runningAgents = allAgents.filter((a) => a.state.status === "running");

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

  // Feature state machine
  const { view, actions } = useFeatureState({
    featureStatus: feature?.status as FeatureStatus | undefined,
    plan: { status: plan.status, blocks: plan.blocks },
    brainstorm: { status: brainstorm.status, blocks: brainstorm.blocks },
    execute: { status: execute.status, blocks: execute.blocks },
    risk: { status: risk.status, blocks: risk.blocks },
    review: { status: review.status, blocks: review.blocks },
  });

  // Track which agent panel is open (auto-opens running agents)
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  // Auto-open the currently running agent, or the last completed one
  useEffect(() => {
    const running = allAgents.find((a) => a.state.status === "running");
    if (running) {
      setOpenAgent(running.label);
    }
  }, [allAgents]);

  // Build the list of agents that have output (to show in the vertical list)
  const agentEntries = useMemo(() => {
    const hasOutput = (state: { status: string; blocks: AgentBlockData[] }) =>
      state.status !== "idle" || state.blocks.length > 0;

    interface EntryState {
      status: AgentStatus;
      blocks: AgentBlockData[];
      subprocessId?: string | null;
      pendingQuestions?: Array<{ question: string; options?: Array<{ label: string; description?: string }> }>;
    }

    const entries: Array<{
      type: AgentType;
      label: string;
      state: EntryState;
    }> = [];

    // Planning agents
    if (hasOutput(plan))
      entries.push({ type: "plan", label: "Plan", state: { status: plan.status, blocks: plan.blocks, subprocessId: plan.subprocessId, pendingQuestions: plan.pendingQuestions } });
    if (hasOutput(brainstorm))
      entries.push({
        type: "brainstorm",
        label: "Brainstorm",
        state: { status: brainstorm.status, blocks: brainstorm.blocks, subprocessId: brainstorm.subprocessId, pendingQuestions: brainstorm.pendingQuestions },
      });

    // Build phase agents — expand parallel execute subprocesses into separate entries
    const execSubs = execute.subprocessList.filter(
      (s) => s.subprocessId !== "__global__",
    );
    if (execSubs.length > 1) {
      // Multiple parallel phases — one panel per subprocess
      for (let i = 0; i < execSubs.length; i++) {
        const sub = execSubs[i];
        entries.push({
          type: "execute",
          label: `Execute ${i + 1}`,
          state: {
            status: sub.status,
            blocks: sub.blocks,
            subprocessId: sub.subprocessId,
          },
        });
      }
    } else if (hasOutput(execute)) {
      // Single phase or merged view
      entries.push({ type: "execute", label: "Execute", state: { status: execute.status, blocks: execute.blocks, subprocessId: execute.subprocessId } });
    }

    // Append global blocks (e.g. error messages) if any
    const globalSub = execute.subprocessList.find(
      (s) => s.subprocessId === "__global__",
    );
    if (globalSub && globalSub.blocks.length > 0 && execSubs.length > 1) {
      entries.push({
        type: "execute",
        label: "Execute",
        state: {
          status: execute.status,
          blocks: globalSub.blocks,
        },
      });
    }

    if (hasOutput(risk))
      entries.push({ type: "risk", label: "Risk", state: { status: risk.status, blocks: risk.blocks, subprocessId: risk.subprocessId } });
    if (hasOutput(review))
      entries.push({ type: "review", label: "Review", state: { status: review.status, blocks: review.blocks, subprocessId: review.subprocessId } });

    return entries;
  }, [plan, brainstorm, execute, risk, review]);

  const hasAnyAgentOutput = agentEntries.length > 0;
  const noAgentsRunning = runningAgents.length === 0;

  return (
    <div className="relative flex h-full flex-col">
      <FeatureTopBar
        featureId={numericFeatureId}
        projectId={numericProjectId}
      />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {/* Draft view with no agent output: show description input */}
        {view === "plan-input" && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Start Planning</h2>
              <p className="text-sm text-muted-foreground">
                Describe the feature you want to build. The Plan agent will
                explore the codebase, ask clarifying questions, and generate a
                phased implementation plan.
              </p>
            </div>
            <Textarea
              placeholder="Describe the feature you want to build..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="resize-none"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleStartPlanning}
                disabled={
                  !description.trim() ||
                  startPlanMutation.isLoading ||
                  startBrainstormMutation.isLoading
                }
              >
                {startPlanMutation.isLoading ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <AGENT_ICONS.plan className="mr-2 size-4" />
                )}
                Start Planning
              </Button>
              <Button
                variant="outline"
                onClick={handleStartBrainstorming}
                disabled={
                  !description.trim() ||
                  startBrainstormMutation.isLoading ||
                  startPlanMutation.isLoading
                }
              >
                {startBrainstormMutation.isLoading ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <AGENT_ICONS.brainstorm className="mr-2 size-4" />
                )}
                Start Brainstorming
              </Button>
            </div>
          </div>
        )}

        {/* Vertical agent list + actions — shown when agents have output or actions are available */}
        {(hasAnyAgentOutput ||
          actions.canStartBuild ||
          actions.canStartRisk ||
          actions.canStartReview) && (
          <div className="space-y-2">
            {agentEntries.map((entry) => (
              <div key={entry.label}>
                <AgentPanel
                  agentType={entry.type}
                  label={entry.label}
                  status={entry.state.status}
                  blocks={entry.state.blocks}
                  open={
                    openAgent === entry.label ||
                    entry.state.status === "running" ||
                    entry.state.status === "paused"
                  }
                  onToggle={() =>
                    setOpenAgent((prev) =>
                      prev === entry.label ? null : entry.label,
                    )
                  }
                  pendingQuestions={
                    entry.type === "plan" && plan.pendingQuestions.length > 0
                      ? plan.pendingQuestions
                      : entry.type === "brainstorm" &&
                          brainstorm.pendingQuestions.length > 0
                        ? brainstorm.pendingQuestions
                        : undefined
                  }
                  onQuestionResponse={
                    entry.type === "plan"
                      ? handleQuestionResponse
                      : entry.type === "brainstorm"
                        ? handleBrainstormQuestionResponse
                        : undefined
                  }
                  onSend={(message) => {
                    if (entry.type === "execute" && entry.state.subprocessId) {
                      // Send directly to the specific execute subprocess
                      sendMessageMutation.mutate({ id: entry.state.subprocessId, message });
                      // Append user message block to the correct subprocess panel
                      execute.appendBlockToSubprocess(entry.state.subprocessId, { type: "user_message", content: message });
                    } else {
                      handleAgentSend(entry.type, message);
                    }
                  }}
                  onStop={() => {
                    if (entry.type === "execute" && entry.state.subprocessId) {
                      // Interrupt this specific execute subprocess (pause, don't kill)
                      void interruptMutation.mutateAsync({ id: entry.state.subprocessId }).catch(() => {});
                    } else {
                      void handleAgentStop(entry.type);
                    }
                  }}
                  resumable={
                    (entry.type === "plan" || entry.type === "brainstorm") &&
                    resumableSessions.has(entry.type)
                  }
                  onResume={
                    entry.type === "plan" || entry.type === "brainstorm"
                      ? () => void handleResume(entry.type)
                      : undefined
                  }
                />

                {/* Review verdict actions */}
                {entry.type === "review" &&
                  reviewComplete &&
                  reviewVerdict === "changes_requested" && (
                    <div className="mt-2 flex gap-2 px-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddFixPhase}
                        disabled={addFixPhaseMutation.isLoading}
                      >
                        {addFixPhaseMutation.isLoading ? (
                          <Loader2Icon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <PlusCircleIcon className="mr-2 size-4" />
                        )}
                        Add Fix Phase
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleFixImmediately}
                        disabled={startExecuteForFixMutation.isLoading}
                      >
                        {startExecuteForFixMutation.isLoading ? (
                          <Loader2Icon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <WrenchIcon className="mr-2 size-4" />
                        )}
                        Fix Immediately
                      </Button>
                    </div>
                  )}
                {entry.type === "review" &&
                  reviewComplete &&
                  reviewVerdict === "approved" && (
                    <div className="mt-2 px-3">
                      <p className="text-sm font-medium text-green-600">
                        Review approved! Feature marked as done.
                      </p>
                    </div>
                  )}
              </div>
            ))}

            {/* Next actions — shown below agents when none are running */}
            {noAgentsRunning &&
              (actions.canStartBuild ||
                actions.canStartRisk ||
                actions.canStartReview) && (
                <div className="space-y-3 pt-4">
                  <div>
                    <h3 className="text-sm font-semibold">Next Steps</h3>
                    <p className="text-xs text-muted-foreground">
                      {actions.canStartBuild && execute.status === "error"
                        ? "Some phases failed. Retry to re-run the errored phases."
                        : actions.canStartBuild
                          ? "The plan is ready. Start building to execute all phases, or evaluate risks first."
                          : "Run a review or risk analysis on the current implementation."}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {actions.canStartBuild && (
                      <Button
                        onClick={handleStartBuilding}
                        disabled={startExecuteMutation.isLoading}
                      >
                        {startExecuteMutation.isLoading ? (
                          <Loader2Icon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <AGENT_ICONS.execute className="mr-2 size-4" />
                        )}
                        {execute.status === "error" ? "Retry Build" : "Start Building"}
                      </Button>
                    )}
                    {actions.canStartRisk && (
                      <Button
                        variant="outline"
                        onClick={handleStartRisk}
                        disabled={startRiskMutation.isLoading}
                      >
                        {startRiskMutation.isLoading ? (
                          <Loader2Icon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <AGENT_ICONS.risk className="mr-2 size-4" />
                        )}
                        Evaluate Risk
                      </Button>
                    )}
                    {actions.canStartReview && (
                      <Button
                        variant="outline"
                        onClick={handleStartReview}
                        disabled={startReviewMutation.isLoading}
                      >
                        {startReviewMutation.isLoading ? (
                          <Loader2Icon className="mr-2 size-4 animate-spin" />
                        ) : (
                          <AGENT_ICONS.review className="mr-2 size-4" />
                        )}
                        Start Review
                      </Button>
                    )}
                  </div>
                </div>
              )}

            {/* Done banner */}
            {view === "done" && (
              <div className="flex items-center gap-3 pt-4">
                <CheckCircle2Icon className="size-8 text-green-600" />
                <div>
                  <h2 className="text-lg font-semibold">Feature Complete</h2>
                  <p className="text-sm text-muted-foreground">
                    This feature has been reviewed and marked as done.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Done view with no agent output visible (edge case) */}
        {view === "done" && !hasAnyAgentOutput && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2Icon className="size-8 text-green-600" />
              <div>
                <h2 className="text-lg font-semibold">Feature Complete</h2>
                <p className="text-sm text-muted-foreground">
                  This feature has been reviewed and marked as done.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
        <PlanSidebar featureId={numericFeatureId} />
      </div>
    </div>
  );
}
