import { useMemo } from "react";
import { promptDropTargetIdOf } from "@/lib/prompt-drop-target";
import type { TabKind } from "@/stores/feature-layout-schema";
import { useAgentFirstNonAgentWork, useStaggeredTabReadiness } from "./useAgentFirstNonAgentWork";
import { useAgentDropZone } from "./WebSocketSessionFeatureBlockLocalHooks";

export function useNonAgentTabReadiness({
  embedded,
  focusedTabId,
  requestedFocusTab,
  sessionId,
}: {
  embedded: boolean;
  focusedTabId: TabKind;
  requestedFocusTab: TabKind | undefined;
  sessionId: string;
}) {
  const immediateTab: TabKind | null =
    focusedTabId !== "agent"
      ? focusedTabId
      : requestedFocusTab != null && requestedFocusTab !== "agent"
        ? requestedFocusTab
        : null;
  const requested = immediateTab !== null;
  const workEnabled = useAgentFirstNonAgentWork({
    enabled: !embedded || requested,
    immediate: requested,
    resetKey: sessionId,
  });
  const tabReady = useStaggeredTabReadiness({
    enabled: workEnabled,
    immediateTab,
    resetKey: sessionId,
  });
  return useMemo(() => ({ workEnabled, tabReady }), [tabReady, workEnabled]);
}

export function useSessionPromptDropZone(sessionId: string, featureId: number) {
  const promptDropTargetId = useMemo(
    () => promptDropTargetIdOf({ wsSessionId: sessionId, featureId }),
    [sessionId, featureId],
  );
  const agentDropZone = useAgentDropZone();
  return useMemo(
    () => ({ agentDropZone, promptDropTargetId }),
    [agentDropZone, promptDropTargetId],
  );
}
