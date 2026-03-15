import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AgentSession } from "@/components/AgentSession";
import { useWebSocketSession } from "@/hooks/useWebSocketSession";

export const Route = createFileRoute("/ws-session/$sessionId")({
  component: WebSocketSessionPage,
});

function WebSocketSessionPage() {
  const { sessionId } = Route.useParams();
  const ws = useWebSocketSession(sessionId);
  const initializedRef = useRef(false);

  // Auto-init session on mount once connected
  const { isConnected, initSession } = ws;
  useEffect(() => {
    if (isConnected && !initializedRef.current) {
      initializedRef.current = true;
      initSession({});
    }
  }, [isConnected, initSession]);

  return (
    <AgentSession
      agentType="session"
      blocks={ws.blocks}
      status={ws.status}
      onSend={ws.sendPrompt}
      onStop={ws.interrupt}
      pendingPermission={ws.pendingPermission}
      onPermissionDecision={(decision) => {
        // Map the decision to granted boolean
        ws.respondToPermission("", decision !== "deny");
      }}
    />
  );
}
