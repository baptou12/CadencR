import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import {
  useAgentState,
  useAgentEventListener,
} from "@/hooks/useAgentState";

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
  const sendInputMutation = trpc.agents.sendInput.useMutation();

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
    plan.clearQuestions();
    if (plan.subprocessId) {
      sendInputMutation.mutate({ id: plan.subprocessId, text: response });
    }
  };

  const handleBrainstormQuestionResponse = (response: string) => {
    brainstorm.clearQuestions();
    if (brainstorm.subprocessId) {
      sendInputMutation.mutate({
        id: brainstorm.subprocessId,
        text: response,
      });
    }
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

  // Visibility flags
  const isDraft = !feature || feature.status === "draft";
  const isPlanned = feature?.status === "planned";
  const isInProgress = feature?.status === "in-progress";
  const showPlanInput =
    isDraft && plan.status === "idle" && brainstorm.status === "idle";
  const showPlanAgent = plan.status !== "idle" || plan.blocks.length > 0;
  const showBrainstormAgent =
    brainstorm.status !== "idle" || brainstorm.blocks.length > 0;
  const showBuildButton = (isPlanned || isInProgress) && execute.status === "idle";
  const showExecuteAgent =
    execute.status !== "idle" || execute.blocks.length > 0;
  const showRiskButton = (isPlanned || isInProgress) && risk.status === "idle";
  const showRiskAgent = risk.status !== "idle" || risk.blocks.length > 0;
  const isReview = feature?.status === "review";
  const showReviewButton =
    (isInProgress || isReview) && review.status === "idle";
  const showReviewAgent =
    review.status !== "idle" || review.blocks.length > 0;

  return (
    <div className="flex h-full flex-col -m-6">
      <FeatureTopBar
        featureId={numericFeatureId}
        projectId={numericProjectId}
      />
      <div className="flex-1 overflow-auto p-6">
        {showPlanInput && (
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

        {showPlanAgent && (
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
              className="h-full"
            />
          </div>
        )}

        {showBrainstormAgent && (
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

        {(showBuildButton || showRiskButton || showReviewButton) &&
          !showPlanAgent &&
          !showBrainstormAgent &&
          !showExecuteAgent &&
          !showRiskAgent &&
          !showReviewAgent && (
            <div className="mx-auto max-w-2xl space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Ready to Build</h2>
                <p className="text-sm text-muted-foreground">
                  The plan is ready. Start building to execute all phases in
                  order, or evaluate risks before proceeding.
                </p>
              </div>
              <div className="flex gap-2">
                {showBuildButton && (
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
                {showRiskButton && (
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
                {showReviewButton && (
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

        {showExecuteAgent && (
          <div className="h-full">
            <AgentPanel
              agentType="execute"
              status={execute.status}
              blocks={execute.blocks}
              className="h-full"
            />
          </div>
        )}

        {showRiskAgent && (
          <div className="h-full">
            <AgentPanel
              agentType="risk"
              status={risk.status}
              blocks={risk.blocks}
              className="h-full"
            />
          </div>
        )}

        {showReviewAgent && (
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

        {!showPlanInput &&
          !showPlanAgent &&
          !showBrainstormAgent &&
          !showBuildButton &&
          !showRiskButton &&
          !showReviewButton &&
          !showExecuteAgent &&
          !showRiskAgent &&
          !showReviewAgent &&
          feature &&
          feature.status !== "draft" && (
            <p className="text-muted-foreground">
              Feature is in &quot;{feature.status}&quot; state.
            </p>
          )}
      </div>
    </div>
  );
}
