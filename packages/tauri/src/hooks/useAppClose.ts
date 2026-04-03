import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { QueryClient } from "@tanstack/react-query";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useEditorStore } from "@/stores/editor-store";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";

export interface RunningAgentInfo {
  sessionId: string;
  label: string;
}

function lookupFeatureTitle(featureId: number | null, queryClient: QueryClient): string | null {
  if (!featureId) return null;
  for (const [, data] of queryClient.getQueriesData<{ id: number; title: string }[]>({ queryKey: ["features", "list"] })) {
    const feature = data?.find((f) => f.id === featureId);
    if (feature) return feature.title;
  }
  return null;
}

function getRunningAgents(queryClient: QueryClient): RunningAgentInfo[] {
  const sessions = useWsSessionStore.getState().sessions;
  const agents: RunningAgentInfo[] = [];
  for (const [sessionId, session] of Object.entries(sessions)) {
    if (session.status !== "running") continue;
    const title = session.featureTitle
      ?? lookupFeatureTitle(session.featureId, queryClient)
      ?? "Untitled";
    const isFeature = sessionId.startsWith("ws-feature-");
    agents.push({
      sessionId,
      label: isFeature ? `${title} - agent` : title,
    });
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
    } else if (isTauri()) {
      void getCurrentWindow().destroy();
    }
  }, [queryClient]);

  const confirmAndClose = useCallback(() => {
    const store = useWsSessionStore.getState();
    for (const { sessionId } of runningAgents) {
      if (store.sessions[sessionId]?.status === "running") {
        store.interrupt(sessionId);
      }
    }
    setShowConfirm(false);
    if (isTauri()) {
      setTimeout(() => { void getCurrentWindow().destroy(); }, 300);
    }
  }, [runningAgents]);

  // X button: always route through requestClose
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      requestClose();
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, [requestClose]);

  // CMD+Q → close app
  useGlobalShortcut("meta+q", (e) => {
    e.preventDefault();
    requestClose();
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
