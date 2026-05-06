import { forwardRef, useImperativeHandle, useRef } from "react";
import { MetaBar, type MetaBarHandle } from "@/components/agent-session/MetaBar";
import { useMetaBarModelProps } from "@/hooks/useMetaBarModelProps";
import { useScopedHotkeys } from "@/hooks/useScopedHotkeys";
import { nextThinkingEffort } from "@/shared/thinking-effort";
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

  // Cmd+T cycles thinking effort. Mirrors `useWsSessionShortcuts` but for the
  // pre-agent kickoff prompt — gate on a focused element inside the sibling
  // AgentPromptBar (`data-agent-prompt-bar="true"`) so the shortcut only fires
  // while the user is interacting with this prompt.
  useScopedHotkeys(
    "meta+t",
    (e) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest("[data-agent-prompt-bar='true']")) {
        return;
      }
      if (modelProps.supportedThinkingEfforts.length === 0) return;
      e.preventDefault();
      const next = nextThinkingEffort(
        modelProps.supportedThinkingEfforts,
        modelProps.currentThinkingEffort,
      );
      modelProps.onThinkingEffortChange(next);
    },
    "agent",
    { enableOnFormTags: true, enableOnContentEditable: true },
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
