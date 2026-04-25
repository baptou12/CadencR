import { useCallback, useRef } from "react";
import { AgentPromptBar } from "@/components/AgentPromptBar";
import type { AgentPromptBarHandle, SplitSendAction } from "@/components/AgentPromptBar";
import {
  StandaloneModelPicker,
  type StandaloneModelPickerHandle,
} from "@/components/StandaloneModelPicker";
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
  const modelPickerRef = useRef<StandaloneModelPickerHandle>(null);
  const internalPromptBarRef = useRef<AgentPromptBarHandle>(null);

  const handlePromptBarRef = useCallback(
    (instance: AgentPromptBarHandle | null) => {
      internalPromptBarRef.current = instance;
      if (!promptBarRef) return;
      if (typeof promptBarRef === "function") {
        promptBarRef(instance);
        return;
      }
      promptBarRef.current = instance;
    },
    [promptBarRef],
  );

  const focusPrompt = useCallback((): void => {
    internalPromptBarRef.current?.focusInput();
  }, []);

  return (
    <div className="w-full rounded-lg border border-border/50">
      <StandaloneModelPicker
        featureId={featureId}
        projectId={projectId}
        agentType={agentType}
        secondaryAgentType={secondaryAgentType}
        onModelSelected={focusPrompt}
        ref={modelPickerRef}
      />
      <AgentPromptBar
        ref={handlePromptBarRef}
        onSend={() => {}}
        onStop={() => {}}
        status="idle"
        disabled={disabled}
        splitSendActions={splitSendActions}
        onOpenModelPicker={() => modelPickerRef.current?.openModelPicker()}
        featureId={featureId}
        projectId={projectId}
        noTopPadding
      />
    </div>
  );
}
