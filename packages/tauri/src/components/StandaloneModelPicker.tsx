import { MetaBar } from "@/components/agent-session/MetaBar";
import { useMetaBarModelProps } from "@/hooks/useMetaBarModelProps";
import type { AgentType } from "@/types/agent-types";

interface StandaloneModelPickerProps {
  featureId: number;
  projectId: number;
  agentType: AgentType;
  /** Optional second agent type kept in lockstep with the primary on change. */
  secondaryAgentType?: AgentType;
}

/**
 * Standalone model picker chip (model + provider + thinking effort) for
 * rendering above a pre-agent kickoff prompt. Wraps `MetaBar` in its
 * `standalone` variant with only the model group enabled.
 */
export function StandaloneModelPicker({
  featureId,
  projectId,
  agentType,
  secondaryAgentType,
}: StandaloneModelPickerProps) {
  const modelProps = useMetaBarModelProps({
    featureId,
    projectId,
    agentType,
    secondaryAgentType,
  });
  return (
    <MetaBar
      variant="standalone"
      showAutoScrollChip={false}
      autoScrollEnabled={false}
      onToggleAutoScroll={() => {}}
      showWorktreeChip={false}
      showDiffBar={false}
      {...modelProps}
    />
  );
}
