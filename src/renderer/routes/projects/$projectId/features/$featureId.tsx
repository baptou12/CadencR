import { useState, useEffect, useMemo, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentPanel } from "@/components/AgentPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc";
import {
  PlayIcon,
  Loader2Icon,
  LightbulbIcon,
  HammerIcon,
  ShieldAlertIcon,
  SearchCheckIcon,
  PlusCircleIcon,
  WrenchIcon,
  CheckCircle2Icon,
  SquareIcon,
} from "lucide-react";
import {
  useAgentState,
  useAgentEventListener,
} from "@/hooks/useAgentState";
import {
  useFeatureState,
  type FeatureStatus,
} from "@/hooks/useFeatureState";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentType } from "../../../../../main/agents/types";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = trpc.features.getById.useQuery({
    id: numericFeatureId,
  });
  const feature = featureQuery.data;

  const [description, setDescription] = useState("");

  // Agent states
  const plan = useAgentState({ supportsQuestions: true });
  const brainstorm = useAgentState({ supportsQuestions: true });
  const execute = useAgentState();
  const risk = useAgentState();
  const review = useAgentState();

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
    (msg: { content: string; message_type: string; tool_name: string | null }): AgentBlockData | null => {
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
      if ((s.status === "completed" || s.status === "error") && !map.has(s.agent_type)) {
        map.set(s.agent_type, s.id);
      }
    }
    return map;
  }, [sessionsQuery.data]);

  // Load history for the most recent plan session (as an example of showing previous conversation)
  const latestPlanSessionId = lastSessionIds.get("plan");
  const planHistoryQuery = trpc.agents.getHistory.useQuery(
    { sessionId: latestPlanSessionId ?? 0 },
    { enabled: !!latestPlanSessionId && plan.status === "idle" && plan.blocks.length === 0 },
  );

  // Populate plan blocks from history on mount
  useEffect(() => {
    if (!planHistoryQuery.data || planHistoryQuery.data.length === 0) return;
    if (plan.status !== "idle" || plan.blocks.length > 0) return;

    const blocks: AgentBlockData[] = [];
    for (const msg of planHistoryQuery.data) {
      const block = messageToBlock(msg);
      if (block) blocks.push(block);
    }
    if (blocks.length > 0) {
      // Merge consecutive text blocks
      const merged: AgentBlockData[] = [];
      for (const b of blocks) {
        const last = merged[merged.length - 1];
        if (b.type === "text" && last?.type === "text") {
          merged[merged.length - 1] = { ...last, content: last.content + b.content };
        } else {
          merged.push(b);
        }
      }
      for (const b of merged) {
        plan.appendBlock(b);
      }
      plan.setStatus("complete");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planHistoryQuery.data]);

  const handleResume = useCallback(
    async (agentType: AgentType) => {
      const claudeSessionId = resumableSessions.get(agentType);
      if (!claudeSessionId) return;

      const agentStateMap: Record<string, ReturnType<typeof useAgentState>> = {
        plan,
        brainstorm,
        execute,
        risk,
        review,
      };
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
    [resumableSessions, plan, brainstorm, execute, risk, review, resumeMutation],
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

  // Listen for AskUserQuestion requests from the main process
  useEffect(() => {
    const api = (
      window as unknown as {
        api?: {
          onAskUserQuestion: (cb: (data: unknown) => void) => unknown;
          offAskUserQuestion: (listener?: unknown) => void;
        };
      }
    ).api;
    if (!api) return;

    const listener = api.onAskUserQuestion((data: unknown) => {
      const request = data as { subprocessId: string; questions: Record<string, unknown> };
      console.log("[FeaturePage] AskUserQuestion request:", request);

      // Determine which agent this question is for
      if (plan.subprocessId === request.subprocessId) {
        console.log("[FeaturePage] Routing question to plan agent");
        // The questions are already being parsed by useAgentState
        // This is just a fallback in case they weren't caught via streaming events
      } else if (brainstorm.subprocessId === request.subprocessId) {
        console.log("[FeaturePage] Routing question to brainstorm agent");
        // Same fallback for brainstorm
      }
    });

    return () => {
      api.offAskUserQuestion(listener as undefined);
    };
  }, [plan.subprocessId, brainstorm.subprocessId]);

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
    if (!brainstorm.subprocessId || brainstorm.pendingQuestions.length === 0) return;

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
  const allAgents = useMemo(() => [
    { state: plan, label: "Plan" },
    { state: brainstorm, label: "Brainstorm" },
    { state: execute, label: "Execute" },
    { state: risk, label: "Risk" },
    { state: review, label: "Review" },
  ], [plan, brainstorm, execute, risk, review]);

  const runningAgents = allAgents.filter((a) => a.state.status === "running");

  const handleStopAll = useCallback(async () => {
    for (const agent of runningAgents) {
      const id = agent.state.subprocessId;
      if (id) {
        try {
          await stopMutation.mutateAsync({ id });
        } catch {
          // best effort
        }
        agent.state.setStatus("error");
        agent.state.appendBlock({
          type: "text",
          content: "\n\nStopped by user.",
        });
      }
    }
  }, [runningAgents, stopMutation]);

  // Feature state machine
  const { view, agents, actions } = useFeatureState({
    featureStatus: feature?.status as FeatureStatus | undefined,
    plan: { status: plan.status, blocks: plan.blocks },
    brainstorm: { status: brainstorm.status, blocks: brainstorm.blocks },
    execute: { status: execute.status, blocks: execute.blocks },
    risk: { status: risk.status, blocks: risk.blocks },
    review: { status: review.status, blocks: review.blocks },
  });

  return (
    <div className="relative flex h-full flex-col -m-6">
      <FeatureTopBar
        featureId={numericFeatureId}
        projectId={numericProjectId}
      />
      <div className="flex-1 overflow-auto p-6">
        {/* Draft view: description input + Plan/Brainstorm buttons */}
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
                  <PlayIcon className="mr-2 size-4" />
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
                  <LightbulbIcon className="mr-2 size-4" />
                )}
                Start Brainstorming
              </Button>
            </div>
          </div>
        )}

        {/* Planning view: plan/brainstorm agent panels */}
        {view === "planning" && (
          <div className="space-y-4">
            {agents.showPlanAgent && (
              <div className="h-full">
                <AgentPanel
                  agentType="plan"
                  status={plan.status}
                  blocks={plan.blocks}
                  pendingQuestions={
                    plan.pendingQuestions.length > 0
                      ? plan.pendingQuestions
                      : undefined
                  }
                  onQuestionResponse={handleQuestionResponse}
                  resumable={resumableSessions.has("plan")}
                  onResume={() => void handleResume("plan")}
                  className="h-full"
                />
              </div>
            )}
            {agents.showBrainstormAgent && (
              <div className="h-full">
                <AgentPanel
                  agentType="brainstorm"
                  status={brainstorm.status}
                  blocks={brainstorm.blocks}
                  pendingQuestions={
                    brainstorm.pendingQuestions.length > 0
                      ? brainstorm.pendingQuestions
                      : undefined
                  }
                  onQuestionResponse={handleBrainstormQuestionResponse}
                  className="h-full"
                />
              </div>
            )}
          </div>
        )}

        {/* Ready to build: action buttons for Build/Risk/Review */}
        {view === "ready-to-build" && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Ready to Build</h2>
              <p className="text-sm text-muted-foreground">
                The plan is ready. Start building to execute all phases in
                order, or evaluate risks before proceeding.
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
                    <HammerIcon className="mr-2 size-4" />
                  )}
                  Start Building
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
                    <ShieldAlertIcon className="mr-2 size-4" />
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
                    <SearchCheckIcon className="mr-2 size-4" />
                  )}
                  Start Review
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Agents active: show all active agent panels (supports concurrent agents) */}
        {view === "agents-active" && (
          <div className="space-y-4">
            {agents.showExecuteAgent && (
              <div className="h-full">
                <AgentPanel
                  agentType="execute"
                  status={execute.status}
                  blocks={execute.blocks}
                  className="h-full"
                />
              </div>
            )}
            {agents.showRiskAgent && (
              <div className="h-full">
                <AgentPanel
                  agentType="risk"
                  status={risk.status}
                  blocks={risk.blocks}
                  className="h-full"
                />
              </div>
            )}
            {agents.showReviewAgent && (
              <div className="h-full">
                <AgentPanel
                  agentType="review"
                  status={review.status}
                  blocks={review.blocks}
                  className="h-full"
                />
                {reviewComplete && reviewVerdict === "changes_requested" && (
                  <div className="mt-4 flex gap-2 border-t pt-4">
                    <Button
                      variant="outline"
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
                {reviewComplete && reviewVerdict === "approved" && (
                  <div className="mt-4 border-t pt-4">
                    <p className="text-sm font-medium text-green-600">
                      Review approved! Feature marked as done.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Done view: summary */}
        {view === "done" && (
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

      {/* Floating stop button */}
      {runningAgents.length > 0 && (
        <div className="absolute bottom-6 right-6">
          <Button
            variant="destructive"
            size="sm"
            className="gap-2 shadow-lg"
            onClick={() => void handleStopAll()}
            disabled={stopMutation.isLoading}
          >
            {stopMutation.isLoading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SquareIcon className="size-4" />
            )}
            Stop {runningAgents.length > 1 ? `All (${runningAgents.length})` : runningAgents[0].label}
          </Button>
        </div>
      )}
    </div>
  );
}
