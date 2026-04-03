import { useEffect } from "react";
import { createEnvelope } from "@/lib/ws-envelope";
import { useAppWsStore } from "@/stores/app-ws-store";

/**
 * Subscribes to file-system change events for a project directory.
 * Sends a subscribe message via the app-level WebSocket when connected.
 */
export function useFileWatcher(projectPath: string): void {
  const ws = useAppWsStore((s) => s.ws);
  const isConnected = useAppWsStore((s) => s.isConnected);

  useEffect(() => {
    if (!ws || !isConnected || ws.readyState !== WebSocket.OPEN || !projectPath) return;

    const envelope = createEnvelope("app", "subscribe.file_watcher", {
      project_path: projectPath,
    });
    ws.send(JSON.stringify(envelope));
  }, [ws, isConnected, projectPath]);
}
