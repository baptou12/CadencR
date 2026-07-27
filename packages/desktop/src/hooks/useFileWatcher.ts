import { useEffect } from "react";
import { createEnvelope } from "@/lib/ws-envelope";
import { useSessionStatusStore } from "@/stores/session-status-store";

/**
 * Subscribes to file-system change events for a project directory.
 * Sends a subscribe message via the app-level WebSocket — the same
 * connection that the session-status store maintains, so we don't open
 * a second socket per app.
 */
export function useFileWatcher(projectId: number, featureId?: number): void {
  const ws = useSessionStatusStore((s) => s.ws);
  const isConnected = useSessionStatusStore((s) => s.isConnected);

  useEffect(() => {
    if (!ws || !isConnected || ws.readyState !== WebSocket.OPEN) return;

    const envelope = createEnvelope("app", "subscribe.file_watcher", {
      project_id: projectId,
      feature_id: featureId,
    });
    ws.send(JSON.stringify(envelope));
  }, [ws, isConnected, projectId, featureId]);
}
