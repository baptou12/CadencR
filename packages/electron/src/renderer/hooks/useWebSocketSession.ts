/**
 * WebSocket session hook — replaces useFeatureAgentState + useAgentChat
 * for ephemeral WebSocket sessions backed by the Rust Axum service.
 *
 * Provides the same data shape consumed by AgentSession/AgentStream/AgentPromptBar.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import type { AgentStatus } from "@/types/agent";
import type { PendingPermission } from "@/components/ToolPermissionPrompt";
import {
  parseEnvelope,
  createSessionInit,
  createPromptSend,
  createPermissionRespond,
  createInterrupt,
  createDestroy,
  type SessionConfig,
} from "@/lib/ws-envelope";

export interface UseWebSocketSessionReturn {
  blocks: AgentBlockData[];
  status: AgentStatus;
  isConnected: boolean;
  sessionId: string;
  pendingPermission: PendingPermission | null;

  sendPrompt: (text: string) => void;
  respondToPermission: (requestId: string, granted: boolean) => void;
  interrupt: () => void;
  destroy: () => void;
  initSession: (config: SessionConfig) => void;
}

function getWsUrl(): string {
  const httpUrl = window.api?.rustBackendUrl;
  if (httpUrl) {
    return httpUrl.replace(/^http/, "ws") + "/ws";
  }
  return "ws://localhost:5005/ws";
}

export function useWebSocketSession(sessionId: string): UseWebSocketSessionReturn {
  const [blocks, setBlocks] = useState<AgentBlockData[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [isConnected, setIsConnected] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const serverSessionIdRef = useRef<string>("");
  const blockCountRef = useRef(0);

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setIsConnected(true);
    });

    ws.addEventListener("close", () => {
      setIsConnected(false);
      setStatus((prev) => (prev === "running" ? "error" : prev));
    });

    ws.addEventListener("error", () => {
      setIsConnected(false);
      setStatus("error");
    });

    ws.addEventListener("message", (event) => {
      try {
        const envelope = parseEnvelope(event.data as string);
        handleEnvelope(envelope);
      } catch {
        // Ignore unparseable messages
      }
    });

    function handleEnvelope(envelope: { domain: string; action: string; payload: unknown }) {
      if (envelope.domain !== "session") return;

      switch (envelope.action) {
        case "initialized": {
          const initPayload = envelope.payload as { session_id?: string };
          if (initPayload.session_id) {
            serverSessionIdRef.current = initPayload.session_id;
          }
          setStatus("idle");
          break;
        }

        case "message": {
          const payload = envelope.payload as { blocks?: unknown[] };
          if (payload.blocks && Array.isArray(payload.blocks)) {
            const newBlocks = payload.blocks.map((b) => {
              const block = b as Record<string, unknown>;
              blockCountRef.current += 1;
              return {
                id: (block.id as string) ?? `ws-${blockCountRef.current}`,
                type: (block.type as AgentBlockData["type"]) ?? "text",
                content: (block.content as string) ?? "",
                toolName: block.tool_name as string | undefined,
                toolArgs: block.tool_args as string | undefined,
                isError: block.is_error as boolean | undefined,
                toolUseId: block.tool_use_id as string | undefined,
              } satisfies AgentBlockData;
            });
            setBlocks((prev) => [...prev, ...newBlocks]);
          }
          setStatus("running");
          break;
        }

        case "permission.request": {
          const p = envelope.payload as {
            request_id: string;
            tool_name: string;
            tool_input: Record<string, unknown>;
            description?: string;
          };
          setPendingPermission({
            toolName: p.tool_name,
            input: p.tool_input ?? {},
            description: p.description ?? "",
            pattern: "",
          });
          setStatus("paused");
          break;
        }

        case "error": {
          setStatus("error");
          const p = envelope.payload as { message?: string };
          if (p.message) {
            blockCountRef.current += 1;
            setBlocks((prev) => [
              ...prev,
              {
                id: `ws-err-${blockCountRef.current}`,
                type: "text",
                content: `Error: ${p.message}`,
                isError: true,
              },
            ]);
          }
          break;
        }

        case "ended":
          setStatus("completed");
          break;

        case "turn_complete":
          setStatus("idle");
          break;
      }
    }

    return () => {
      // Send destroy before closing
      if (ws.readyState === WebSocket.OPEN && serverSessionIdRef.current) {
        ws.send(JSON.stringify(createDestroy(serverSessionIdRef.current)));
      }
      ws.close();
    };
  }, [sessionId]);

  const initSession = useCallback(
    (config: SessionConfig) => {
      send(createSessionInit(config));
    },
    [send],
  );

  const sendPrompt = useCallback(
    (text: string) => {
      send(createPromptSend(serverSessionIdRef.current, text));
      setStatus("running");
    },
    [send],
  );

  const respondToPermission = useCallback(
    (requestId: string, granted: boolean) => {
      send(createPermissionRespond(serverSessionIdRef.current, requestId, granted));
      setPendingPermission(null);
      setStatus("running");
    },
    [send],
  );

  const interrupt = useCallback(() => {
    send(createInterrupt(serverSessionIdRef.current));
  }, [send]);

  const destroySession = useCallback(() => {
    send(createDestroy(serverSessionIdRef.current));
    setStatus("completed");
  }, [send]);

  return {
    blocks,
    status,
    isConnected,
    sessionId,
    pendingPermission,
    sendPrompt,
    respondToPermission,
    interrupt,
    destroy: destroySession,
    initSession,
  };
}
