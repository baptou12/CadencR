import { Loader2Icon } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { AgentPromptBar } from "@/components/AgentPromptBar";
import type { SplitSendAction } from "@/components/AgentPromptBar";
import { useMemo } from "react";

interface PlanInputImage {
  base64: string;
  mimeType: string;
}

interface PlanInputViewProps {
  onStartPlanning: (description: string, images: PlanInputImage[]) => void;
  onStartPrd: (description: string, images: PlanInputImage[]) => void;
  isStartingPlan: boolean;
  isStartingPrd: boolean;
}

export function PlanInputView({
  onStartPlanning,
  onStartPrd,
  isStartingPlan,
  isStartingPrd,
}: PlanInputViewProps) {
  const isDisabled = isStartingPlan || isStartingPrd;

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
          Describe the feature you want to build. The Plan agent will explore
          the codebase, ask clarifying questions, and generate a phased
          implementation plan.
        </p>
      </div>
      <div className="w-full rounded-lg border border-border/50">
        <AgentPromptBar
          onSend={() => {}}
          onStop={() => {}}
          status="idle"
          disabled={isDisabled}
          splitSendActions={splitSendActions}
        />
      </div>
    </div>
  );
}
