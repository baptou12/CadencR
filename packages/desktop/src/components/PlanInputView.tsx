import { Loader2Icon } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import type { SplitSendAction } from "@/components/AgentPromptBar";
import { PromptWithModelPicker } from "@/components/PromptWithModelPicker";
import { useMemo } from "react";

interface PlanInputImage {
  base64: string;
  mimeType: string;
}

interface PlanInputViewProps {
  featureId: number;
  projectId: number;
  onStartPlanning: (description: string, images: PlanInputImage[]) => void;
  onStartPrd: (description: string, images: PlanInputImage[]) => void;
  isStartingPlan: boolean;
  isStartingPrd: boolean;
  /** Forwarded to the inner prompt bar — gates agent-menu shortcuts on agent tab visibility. */
  agentTabActive?: boolean;
}

export function PlanInputView({
  featureId,
  projectId,
  onStartPlanning,
  onStartPrd,
  isStartingPlan,
  isStartingPrd,
  agentTabActive,
}: PlanInputViewProps) {
  const splitSendActions: SplitSendAction[] = useMemo(
    () => [
      {
        label: "Plan",
        icon: isStartingPlan ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <AGENT_ICONS.plan className="mr-2 size-4" />
        ),
        variant: "default" as const,
        kbdShortcut: ["enter"],
        onClick: (text: string, images?: PlanInputImage[]) => {
          onStartPlanning(text, images ?? []);
        },
      },
      {
        label: "PRD",
        icon: isStartingPrd ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <AGENT_ICONS.prd className="mr-2 size-4" />
        ),
        variant: "outline" as const,
        onClick: (text: string, images?: PlanInputImage[]) => {
          onStartPrd(text, images ?? []);
        },
      },
    ],
    [isStartingPlan, isStartingPrd, onStartPlanning, onStartPrd],
  );

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Start Planning</h2>
        <p className="text-sm text-muted-foreground">
          Describe the feature you want to build. The Plan agent will explore the codebase, ask
          clarifying questions, and generate a phased implementation plan.
        </p>
      </div>
      <PromptWithModelPicker
        featureId={featureId}
        projectId={projectId}
        agentType="plan"
        secondaryAgentType="prd"
        disabled={isStartingPlan || isStartingPrd}
        splitSendActions={splitSendActions}
        agentTabActive={agentTabActive}
      />
    </div>
  );
}
