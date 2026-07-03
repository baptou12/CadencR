import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { isTurnActive } from "@/stores/ws-turn-lifecycle";
import { useEditorStore } from "@/stores/editor-store";
import { browserTabCount } from "@/stores/browser-store";
import { useTerminalStore } from "@/hooks/useTerminalState";
import { getFocusedTabForFeature } from "@/lib/feature-focus-handoff";
import { useGlobalShortcutById } from "@/hooks/useShortcut";
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

// True when the focused tab in `featureId` still owns ⌘W — i.e. there's
// something for the editor/terminal sibling handler to close. In that case
// the app-close fallback bails so the sibling handler can take the chord.
// Exported for testing; production callers use it via the ⌘W handler below.
export function shouldBypassAppClose(featureId: number | null): boolean {
  if (featureId == null) return false;
  const focusedTab = getFocusedTabForFeature(featureId);
  if (focusedTab === "editor") {
    const panes = useEditorStore.getState().features[featureId]?.panes ?? {};
    return Object.values(panes).some((p) => p.tabs.length > 0);
  }
  if (focusedTab === "terminal") {
    return useTerminalStore.getState().features[featureId]?.root != null;
  }
  if (focusedTab === "browser") {
    // ⌘W closes the focused browser tab while any exist; only an empty
    // browser surface lets the chord fall through to close the window.
    return browserTabCount() > 0;
  }
  return false;
}

function getRunningAgents(queryClient: QueryClient): RunningAgentInfo[] {
  const agents: RunningAgentInfo[] = [];
  const sessions = useWsSessionStore.getState().sessions;
  for (const [sessionId, session] of Object.entries(sessions)) {
    if (!isTurnActive(session.lifecycle)) continue;
    const title =
      session.featureTitle ?? lookupFeatureTitle(session.featureId, queryClient) ?? "Untitled";
    // `ws-feature-` is a legacy WS session ID prefix (the ws-feature feature
    // type itself was removed). Treat any session with that prefix as a
    // pre-rename ws-session entry for label purposes.
    const isLegacyPrefixed = sessionId.startsWith("ws-feature-");
    agents.push({
      sessionId,
      label: isLegacyPrefixed ? `${title} - agent` : title,
    });
  }
  return agents;
}

export function useAppClose(queryClient: QueryClient, activeFeatureId: number | null) {
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
    for (const { sessionId } of runningAgents) {
      if (wsStore.sessions[sessionId] && isTurnActive(wsStore.sessions[sessionId].lifecycle)) {
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
  useGlobalShortcutById("quit", (e) => {
    e.preventDefault();
    void desktopBridge.requestQuit();
  });

  // ⌘W / Ctrl+W → close the window when nothing else owns the chord. The
  // editor/terminal sibling handlers take ⌘W on their own tabs; this is
  // the "I'm on an empty editor / non-owning tab, ⌘W should close the
  // window" fallback. Scoping the bypass to the *focused tab's* owning
  // surface (not the whole feature) is intentional — see registry entry.
  useGlobalShortcutById("app-close", (e) => {
    if (shouldBypassAppClose(activeFeatureId)) return;
    e.preventDefault();
    requestClose();
  });

  return useMemo(
    () => ({
      showConfirm,
      setShowConfirm,
      runningAgents,
      confirmAndClose,
    }),
    [showConfirm, setShowConfirm, runningAgents, confirmAndClose],
  );
}
