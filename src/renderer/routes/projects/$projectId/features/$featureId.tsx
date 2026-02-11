import { useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentPanel, type AgentStatus } from "@/components/AgentPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc";
import { PlayIcon, Loader2Icon, LightbulbIcon, HammerIcon, ShieldAlertIcon } from "lucide-react";
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

  const [brainstormSubprocessId, setBrainstormSubprocessId] = useState<string | null>(null);
  const [brainstormBlocks, setBrainstormBlocks] = useState<AgentBlockData[]>([]);
  const [brainstormStatus, setBrainstormStatus] = useState<AgentStatus>("idle");
  const [brainstormPendingQuestions, setBrainstormPendingQuestions] = useState<AgentQuestion[]>([]);
  const brainstormSubprocessIdRef = useRef<string | null>(null);

  const [executeBlocks, setExecuteBlocks] = useState<AgentBlockData[]>([]);
  const [executeStatus, setExecuteStatus] = useState<AgentStatus>("idle");

  const [riskBlocks, setRiskBlocks] = useState<AgentBlockData[]>([]);
  const [riskStatus, setRiskStatus] = useState<AgentStatus>("idle");

  const startPlanMutation = trpc.agents.startPlan.useMutation();
  const startBrainstormMutation = trpc.agents.startBrainstorm.useMutation();
  const startExecuteMutation = trpc.agents.startExecute.useMutation();
  const startRiskMutation = trpc.agents.startRisk.useMutation();
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

  const handleBrainstormEvent = useCallback((agentEvent: AgentEvent) => {
    const { event } = agentEvent;

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text") {
          setBrainstormBlocks((prev) => [
            ...prev,
            makeBlock({ type: "text", content: event.content_block.type === "text" ? event.content_block.text : "" }),
          ]);
        } else if (event.content_block.type === "tool_use") {
          const toolBlock = event.content_block;
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
              setBrainstormPendingQuestions(questions);
            }
          }
          setBrainstormBlocks((prev) => [
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
          setBrainstormBlocks((prev) => {
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
        setBrainstormBlocks((prev) => [
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
        setBrainstormStatus("error");
        setBrainstormBlocks((prev) => [
          ...prev,
          makeBlock({ type: "text", content: `Error: ${event.error.message}` }),
        ]);
        break;
      }
    }
  }, []);

  const handleExecuteEvent = useCallback((agentEvent: AgentEvent) => {
    const { event } = agentEvent;

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text") {
          setExecuteBlocks((prev) => [
            ...prev,
            makeBlock({ type: "text", content: event.content_block.type === "text" ? event.content_block.text : "" }),
          ]);
        } else if (event.content_block.type === "tool_use") {
          const toolBlock = event.content_block;
          setExecuteBlocks((prev) => [
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
          setExecuteBlocks((prev) => {
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
        setExecuteBlocks((prev) => [
          ...prev,
          makeBlock({
            type: "tool_result",
            content: event.content,
            isError: event.is_error ?? false,
          }),
        ]);
        break;
      }
      case "error": {
        setExecuteStatus("error");
        setExecuteBlocks((prev) => [
          ...prev,
          makeBlock({ type: "text", content: `Error: ${event.error.message}` }),
        ]);
        break;
      }
    }
  }, []);

  const handleRiskEvent = useCallback((agentEvent: AgentEvent) => {
    const { event } = agentEvent;

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text") {
          setRiskBlocks((prev) => [
            ...prev,
            makeBlock({ type: "text", content: event.content_block.type === "text" ? event.content_block.text : "" }),
          ]);
        } else if (event.content_block.type === "tool_use") {
          const toolBlock = event.content_block;
          setRiskBlocks((prev) => [
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
          setRiskBlocks((prev) => {
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
        setRiskBlocks((prev) => [
          ...prev,
          makeBlock({
            type: "tool_result",
            content: event.content,
            isError: event.is_error ?? false,
          }),
        ]);
        break;
      }
      case "error": {
        setRiskStatus("error");
        setRiskBlocks((prev) => [
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

      if (agentEvent.agentType === "plan") {
        const currentId = planSubprocessIdRef.current;
        if (currentId && agentEvent.subprocessId !== currentId) return;
        handlePlanEvent(agentEvent);
      } else if (agentEvent.agentType === "brainstorm") {
        const currentId = brainstormSubprocessIdRef.current;
        if (currentId && agentEvent.subprocessId !== currentId) return;
        handleBrainstormEvent(agentEvent);
      } else if (agentEvent.agentType === "execute") {
        handleExecuteEvent(agentEvent);
      } else if (agentEvent.agentType === "risk") {
        handleRiskEvent(agentEvent);
      }
    });

    return () => {
      api.offAgentEvent(listener as undefined);
    };
  }, [handlePlanEvent, handleBrainstormEvent, handleExecuteEvent, handleRiskEvent]);

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

  const handleStartBrainstorming = async () => {
    if (!description.trim()) return;

    setBrainstormStatus("running");
    setBrainstormBlocks([]);
    setBrainstormPendingQuestions([]);

    try {
      const result = await startBrainstormMutation.mutateAsync({
        featureId: numericFeatureId,
        projectId: numericProjectId,
        description: description.trim(),
      });
      setBrainstormSubprocessId(result.subprocessId);
      brainstormSubprocessIdRef.current = result.subprocessId;
    } catch (err) {
      setBrainstormStatus("error");
      setBrainstormBlocks([
        makeBlock({
          type: "text",
          content: `Failed to start brainstorm agent: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ]);
    }
  };

  const handleBrainstormQuestionResponse = (response: string) => {
    setBrainstormPendingQuestions([]);
    if (brainstormSubprocessId) {
      sendInputMutation.mutate({ id: brainstormSubprocessId, text: response });
    }
  };

  const handleQuestionResponse = (response: string) => {
    setPendingQuestions([]);
    if (planSubprocessId) {
      sendInputMutation.mutate({ id: planSubprocessId, text: response });
    }
  };

  const handleStartBuilding = async () => {
    setExecuteStatus("running");
    setExecuteBlocks([]);

    try {
      await startExecuteMutation.mutateAsync({
        featureId: numericFeatureId,
        projectId: numericProjectId,
      });
    } catch (err) {
      setExecuteStatus("error");
      setExecuteBlocks([
        makeBlock({
          type: "text",
          content: `Failed to start execute agent: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ]);
    }
  };

  const handleStartRisk = async () => {
    setRiskStatus("running");
    setRiskBlocks([]);

    try {
      await startRiskMutation.mutateAsync({
        featureId: numericFeatureId,
        projectId: numericProjectId,
      });
    } catch (err) {
      setRiskStatus("error");
      setRiskBlocks([
        makeBlock({
          type: "text",
          content: `Failed to start risk agent: ${err instanceof Error ? err.message : String(err)}`,
        }),
      ]);
    }
  };

  const isDraft = !feature || feature.status === "draft";
  const isPlanned = feature?.status === "planned";
  const isInProgress = feature?.status === "in-progress";
  const showPlanInput = isDraft && planStatus === "idle" && brainstormStatus === "idle";
  const showPlanAgent = planStatus !== "idle" || planBlocks.length > 0;
  const showBrainstormAgent = brainstormStatus !== "idle" || brainstormBlocks.length > 0;
  const showBuildButton = (isPlanned || isInProgress) && executeStatus === "idle";
  const showExecuteAgent = executeStatus !== "idle" || executeBlocks.length > 0;
  const showRiskButton = (isPlanned || isInProgress) && riskStatus === "idle";
  const showRiskAgent = riskStatus !== "idle" || riskBlocks.length > 0;

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
            <div className="flex gap-2">
              <Button
                onClick={handleStartPlanning}
                disabled={!description.trim() || startPlanMutation.isLoading || startBrainstormMutation.isLoading}
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
                disabled={!description.trim() || startBrainstormMutation.isLoading || startPlanMutation.isLoading}
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
              status={planStatus}
              blocks={planBlocks}
              pendingQuestions={pendingQuestions.length > 0 ? pendingQuestions : undefined}
              onQuestionResponse={handleQuestionResponse}
              className="h-full"
            />
          </div>
        )}

        {showBrainstormAgent && (
          <div className="h-full">
            <AgentPanel
              agentType="brainstorm"
              status={brainstormStatus}
              blocks={brainstormBlocks}
              pendingQuestions={brainstormPendingQuestions.length > 0 ? brainstormPendingQuestions : undefined}
              onQuestionResponse={handleBrainstormQuestionResponse}
              className="h-full"
            />
          </div>
        )}

        {(showBuildButton || showRiskButton) && !showPlanAgent && !showBrainstormAgent && !showExecuteAgent && !showRiskAgent && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Ready to Build</h2>
              <p className="text-sm text-muted-foreground">
                The plan is ready. Start building to execute all phases in order,
                or evaluate risks before proceeding.
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
            </div>
          </div>
        )}

        {showExecuteAgent && (
          <div className="h-full">
            <AgentPanel
              agentType="execute"
              status={executeStatus}
              blocks={executeBlocks}
              className="h-full"
            />
          </div>
        )}

        {showRiskAgent && (
          <div className="h-full">
            <AgentPanel
              agentType="risk"
              status={riskStatus}
              blocks={riskBlocks}
              className="h-full"
            />
          </div>
        )}

        {!showPlanInput && !showPlanAgent && !showBrainstormAgent && !showBuildButton && !showRiskButton && !showExecuteAgent && !showRiskAgent && feature && feature.status !== "draft" && (
          <p className="text-muted-foreground">
            Feature is in &quot;{feature.status}&quot; state.
          </p>
        )}
      </div>
    </div>
  );
}
