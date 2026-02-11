import { useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentPanel, type AgentStatus } from "@/components/AgentPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc";
import { PlayIcon, Loader2Icon } from "lucide-react";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentQuestion } from "@/components/AgentQuestionDrawer";
import type { AgentEvent } from "../../../../../main/agents/types";

export const Route = createFileRoute(
  "/projects/$projectId/features/$featureId",
)({
  component: FeaturePage,
});

let blockIdCounter = 0;
function makeBlock(partial: Omit<AgentBlockData, "id">): AgentBlockData {
  blockIdCounter += 1;
  return { id: `block-${blockIdCounter}`, ...partial };
}

function FeaturePage() {
  const { featureId, projectId } = Route.useParams();
  const numericFeatureId = Number(featureId);
  const numericProjectId = Number(projectId);

  const featureQuery = trpc.features.getById.useQuery({ id: numericFeatureId });
  const feature = featureQuery.data;

  const [description, setDescription] = useState("");
  const [planSubprocessId, setPlanSubprocessId] = useState<string | null>(null);
  const [planBlocks, setPlanBlocks] = useState<AgentBlockData[]>([]);
  const [planStatus, setPlanStatus] = useState<AgentStatus>("idle");
  const [pendingQuestions, setPendingQuestions] = useState<AgentQuestion[]>([]);
  const planSubprocessIdRef = useRef<string | null>(null);

  const startPlanMutation = trpc.agents.startPlan.useMutation();
  const sendInputMutation = trpc.agents.sendInput.useMutation();

  const handlePlanEvent = useCallback((agentEvent: AgentEvent) => {
    const { event } = agentEvent;

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text") {
          setPlanBlocks((prev) => [
            ...prev,
            makeBlock({ type: "text", content: event.content_block.type === "text" ? event.content_block.text : "" }),
          ]);
        } else if (event.content_block.type === "tool_use") {
          const toolBlock = event.content_block;
          // Check for AskUserQuestion
          if (toolBlock.name === "AskUserQuestion") {
            const toolInput = toolBlock.input as Record<string, unknown>;
            const questions: AgentQuestion[] = [];
            if (Array.isArray(toolInput.questions)) {
              for (const q of toolInput.questions) {
                const qObj = q as { question: string; options?: string[] };
                questions.push({
                  question: qObj.question,
                  options: qObj.options ?? [],
                });
              }
            } else if (typeof toolInput.question === "string") {
              questions.push({
                question: toolInput.question as string,
                options: Array.isArray(toolInput.options) ? (toolInput.options as string[]) : [],
              });
            }
            if (questions.length > 0) {
              setPendingQuestions(questions);
            }
          }
          setPlanBlocks((prev) => [
            ...prev,
            makeBlock({
              type: "tool_call",
              content: JSON.stringify(toolBlock.input, null, 2),
              toolName: toolBlock.name,
              toolArgs: JSON.stringify(toolBlock.input, null, 2),
            }),
          ]);
        }
        break;
      }
      case "content_block_delta": {
        if (event.delta.type === "text_delta") {
          const deltaText = event.delta.text;
          setPlanBlocks((prev) => {
            if (prev.length === 0) return [makeBlock({ type: "text", content: deltaText })];
            const last = prev[prev.length - 1];
            if (last.type === "text") {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + deltaText },
              ];
            }
            return [...prev, makeBlock({ type: "text", content: deltaText })];
          });
        }
        break;
      }
      case "tool_result": {
        setPlanBlocks((prev) => [
          ...prev,
          makeBlock({
            type: "tool_result",
            content: event.content,
            isError: event.is_error ?? false,
          }),
        ]);
        break;
      }
      case "message_stop": {
        break;
      }
      case "error": {
        setPlanStatus("error");
        setPlanBlocks((prev) => [
          ...prev,
          makeBlock({ type: "text", content: `Error: ${event.error.message}` }),
        ]);
        break;
      }
    }
  }, []);

  // Listen for agent events via IPC bridge
  useEffect(() => {
    const api = (window as unknown as { api?: {
      onAgentEvent: (cb: (event: unknown) => void) => unknown;
      offAgentEvent: (listener?: unknown) => void;
    } }).api;
    if (!api) return;

    const listener = api.onAgentEvent((data: unknown) => {
      const agentEvent = data as AgentEvent;
      if (agentEvent.agentType !== "plan") return;
      const currentId = planSubprocessIdRef.current;
      if (currentId && agentEvent.subprocessId !== currentId) return;

      handlePlanEvent(agentEvent);
    });

    return () => {
      api.offAgentEvent(listener as undefined);
    };
  }, [handlePlanEvent]);

  const handleStartPlanning = async () => {
    if (!description.trim()) return;

    setPlanStatus("running");
    setPlanBlocks([]);
    setPendingQuestions([]);

    try {
      const result = await startPlanMutation.mutateAsync({
        featureId: numericFeatureId,
        projectId: numericProjectId,
        description: description.trim(),
      });
      setPlanSubprocessId(result.subprocessId);
      planSubprocessIdRef.current = result.subprocessId;
    } catch (err) {
      setPlanStatus("error");
      setPlanBlocks([
        makeBlock({
          type: "text",
          content: `Failed to start plan agent: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ]);
    }
  };

  const handleQuestionResponse = (response: string) => {
    setPendingQuestions([]);
    if (planSubprocessId) {
      sendInputMutation.mutate({ id: planSubprocessId, text: response });
    }
  };

  const isDraft = !feature || feature.status === "draft";
  const showPlanInput = isDraft && planStatus === "idle";
  const showPlanAgent = planStatus !== "idle" || planBlocks.length > 0;

  return (
    <div className="flex h-full flex-col -m-6">
      <FeatureTopBar featureId={numericFeatureId} projectId={numericProjectId} />
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
            <Button
              onClick={handleStartPlanning}
              disabled={!description.trim() || startPlanMutation.isLoading}
            >
              {startPlanMutation.isLoading ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <PlayIcon className="mr-2 size-4" />
              )}
              Start Planning
            </Button>
          </div>
        )}

        {showPlanAgent && (
          <div className="h-full">
            <AgentPanel
              agentType="plan"
              status={planStatus}
              blocks={planBlocks}
              pendingQuestions={pendingQuestions.length > 0 ? pendingQuestions : undefined}
              onQuestionResponse={handleQuestionResponse}
              className="h-full"
            />
          </div>
        )}

        {!showPlanInput && !showPlanAgent && feature && feature.status !== "draft" && (
          <p className="text-muted-foreground">
            Feature is in &quot;{feature.status}&quot; state. Planning is complete.
          </p>
        )}
      </div>
    </div>
  );
}
