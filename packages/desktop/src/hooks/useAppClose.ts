import { useCallback, useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { isTurnActive } from "@/stores/ws-turn-lifecycle";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { useEditorStore } from "@/stores/editor-store";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { getListFeaturesQueryKey } from "@/api/generated";
import { desktopBridge } from "@/lib/desktop-bridge";

interface RunningAgentInfo {
  sessionId: string;
  label: string;
}

function lookupFeatureTitle(featureId: number | null, queryClient: QueryClient): string | null {
  if (!featureId) return null;
  for (const [, data] of queryClient.getQueriesData<{ id: number; title: string }[]>({
    queryKey: getListFeaturesQueryKey(),
  })) {
    const feature = data?.find((f) => f.id === featureId);
    if (feature) return feature.title;
  }
  return null;
}

function getRunningAgents(queryClient: QueryClient): RunningAgentInfo[] {
  const agents: RunningAgentInfo[] = [];

  // Check ws-session / ws-feature agents
  const sessions = useWsSessionStore.getState().sessions;
  for (const [sessionId, session] of Object.entries(sessions)) {
    if (!isTurnActive(session.lifecycle)) continue;
    const title =
      session.featureTitle ?? lookupFeatureTitle(session.featureId, queryClient) ?? "Untitled";
    const isFeature = sessionId.startsWith("ws-feature-");
    agents.push({
      sessionId,
      label: isFeature ? `${title} - agent` : title,
    });
  }

  // Check workflow agents
  const wfState = useWorkflowStore.getState();
  if (wfState.featureId) {
    for (const [slotKey, agent] of wfState.agents) {
      if (agent.status !== "running") continue;
      const title =
        wfState.featureTitle ?? lookupFeatureTitle(wfState.featureId, queryClient) ?? "Workflow";
      agents.push({
        sessionId: `wf:${wfState.featureId}:${slotKey}`,
        label: `${title} - ${agent.agentType}`,
      });
    }
  }

  return agents;
}

export function useAppClose(queryClient: QueryClient) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [runningAgents, setRunningAgents] = useState<RunningAgentInfo[]>([]);

  const requestClose = useCallback(() => {
    const agents = getRunningAgents(queryClient);
    if (agents.length > 0) {
      setRunningAgents(agents);
      setShowConfirm(true);
    } else {
      void desktopBridge.confirmClose();
    }
  }, [queryClient]);

  const confirmAndClose = useCallback(() => {
    const wsStore = useWsSessionStore.getState();
    const wfStore = useWorkflowStore.getState();
    for (const { sessionId } of runningAgents) {
      if (sessionId.startsWith("wf:")) {
        // Workflow agent — extract slotKey and interrupt via workflow store
        const slotKey = sessionId.split(":").slice(2).join(":");
        wfStore.interruptItem(slotKey);
      } else if (
        wsStore.sessions[sessionId] &&
        isTurnActive(wsStore.sessions[sessionId].lifecycle)
      ) {
        wsStore.interrupt(sessionId);
      }
    }
    setShowConfirm(false);
    setTimeout(() => {
      void desktopBridge.confirmClose();
    }, 300);
  }, [runningAgents]);

  // X button: always route through requestClose
  useEffect(() => {
    return desktopBridge.onCloseRequested(requestClose);
  }, [requestClose]);

  // CMD+Q → quit the app. This must go through Electron's quit path so
  // `before-quit` runs and the production sidecar is stopped.
  useGlobalShortcut("meta+q", (e) => {
    e.preventDefault();
    void desktopBridge.requestQuit();
  });

  // CMD+W → close app (only when no editor buffers; EditorSubTabs owns CMD+W when buffers exist)
  useGlobalShortcut("meta+w", (e) => {
    const hasBuffers = Object.values(useEditorStore.getState().features).some((f) =>
      Object.values(f.panes).some((p) => p.tabs.length > 0),
    );
    if (hasBuffers) return;
    e.preventDefault();
    requestClose();
  });

  return {
    showConfirm,
    setShowConfirm,
    runningAgents,
    confirmAndClose,
  };
}
