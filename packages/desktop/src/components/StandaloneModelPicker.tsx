import { forwardRef, useImperativeHandle, useRef } from "react";
import { MetaBar, type MetaBarHandle } from "@/components/agent-session/MetaBar";
import { useMetaBarModelProps } from "@/hooks/useMetaBarModelProps";
import type { AgentType } from "@/types/agent-types";

interface StandaloneModelPickerProps {
  featureId: number;
  projectId: number;
  agentType: AgentType;
  /** Optional second agent type kept in lockstep with the primary on change. */
  secondaryAgentType?: AgentType;
  onModelSelected?: () => void;
}

export interface StandaloneModelPickerHandle {
  openModelPicker: () => void;
}

/**
 * Standalone model picker chip (model + provider + thinking effort) for
 * rendering above a pre-agent kickoff prompt. Wraps `MetaBar` in its
 * `standalone` variant with only the model group enabled.
 */
export const StandaloneModelPicker = forwardRef<
  StandaloneModelPickerHandle,
  StandaloneModelPickerProps
>(function StandaloneModelPicker(
  { featureId, projectId, agentType, secondaryAgentType, onModelSelected },
  ref,
) {
  const metaBarRef = useRef<MetaBarHandle>(null);
  const modelProps = useMetaBarModelProps({
    featureId,
    projectId,
    agentType,
    secondaryAgentType,
  });

  useImperativeHandle(
    ref,
    () => ({
      openModelPicker: () => metaBarRef.current?.openModelPicker(),
    }),
    [],
  );

  return (
    <MetaBar
      ref={metaBarRef}
      variant="standalone"
      showAutoScrollChip={false}
      autoScrollEnabled={false}
      onToggleAutoScroll={() => {}}
      showWorktreeChip={false}
      showDiffBar={false}
      onModelSelected={onModelSelected}
      {...modelProps}
    />
  );
});
