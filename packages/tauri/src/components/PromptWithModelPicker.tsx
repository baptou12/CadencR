import { AgentPromptBar } from "@/components/AgentPromptBar";
import type {
  AgentPromptBarHandle,
  SplitSendAction,
} from "@/components/AgentPromptBar";
import { StandaloneModelPicker } from "@/components/StandaloneModelPicker";
import type { AgentType } from "@/types/agent-types";

interface PromptWithModelPickerProps {
  featureId: number;
  projectId: number;
  agentType: AgentType;
  /** Optional second agent type kept in lockstep with `agentType` (e.g. Plan + PRD). */
  secondaryAgentType?: AgentType;
  disabled?: boolean;
  splitSendActions: SplitSendAction[];
  promptBarRef?: React.Ref<AgentPromptBarHandle>;
}

/**
 * Prompt bar wrapped in a bordered container with a standalone model picker
 * above it. Used for pre-agent kickoff prompts in the ws-feature flow
 * (PlanInputView, NextStepsBar refine/session).
 */
export function PromptWithModelPicker({
  featureId,
  projectId,
  agentType,
  secondaryAgentType,
  disabled,
  splitSendActions,
  promptBarRef,
}: PromptWithModelPickerProps) {
  return (
    <div className="w-full rounded-lg border border-border/50">
      <StandaloneModelPicker
        featureId={featureId}
        projectId={projectId}
        agentType={agentType}
        secondaryAgentType={secondaryAgentType}
      />
      <AgentPromptBar
        ref={promptBarRef}
        onSend={() => {}}
        onStop={() => {}}
        status="idle"
        disabled={disabled}
        splitSendActions={splitSendActions}
        featureId={featureId}
        projectId={projectId}
        noTopPadding
      />
    </div>
  );
}
