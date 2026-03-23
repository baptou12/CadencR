import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";

// -- Message types matching Rust backend protocol --

interface TerminalMessageData {
  type: "data";
  data: string;
}

interface TerminalMessageReady {
  type: "ready";
  pty_id: string;
}

interface TerminalMessageExit {
  type: "exit";
  code: number;
}

interface TerminalMessageReconnected {
  type: "reconnected";
  scrollback: string;
  alive: boolean;
}

interface TerminalMessageError {
  type: "error";
  message: string;
}

type TerminalMessage =
  | TerminalMessageData
  | TerminalMessageReady
  | TerminalMessageExit
  | TerminalMessageReconnected
  | TerminalMessageError;

export interface UseTerminalWebSocketOptions {
  featureId?: number;
  projectId?: number;
  ptyId?: string;
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onReady: (ptyId: string) => void;
  onReconnected: (scrollback: string, alive: boolean) => void;
  onError: (message: string) => void;
}

export interface UseTerminalWebSocketReturn {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  isConnected: boolean;
}

function buildWsUrl(options: UseTerminalWebSocketOptions): string {
  const httpUrl = import.meta.env.VITE_API_URL || "http://localhost:5005";
  const wsUrl = httpUrl.replace(/^http/, "ws");
  const params = new URLSearchParams();

  if (options.ptyId) {
    params.set("pty_id", options.ptyId);
  } else {
    if (options.featureId != null) params.set("feature_id", String(options.featureId));
    if (options.projectId != null) params.set("project_id", String(options.projectId));
  }

  return `${wsUrl}/api/terminal/ws?${params.toString()}`;
}

function sendJson(ws: WebSocket | null, msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function useTerminalWebSocket(
  options: UseTerminalWebSocketOptions,
): UseTerminalWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Capture connection params at mount time — we don't want to re-connect
  // when ptyId is assigned from our own onReady callback (that would tear
  // down the working connection and try to reconnect immediately).
  const initialOptionsRef = useRef(options);

  useEffect(() => {
    let intentionalClose = false;
    const url = buildWsUrl(initialOptionsRef.current);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as TerminalMessage;
        const cb = optionsRef.current;
        switch (msg.type) {
          case "data":
            cb.onData(msg.data);
            break;
          case "ready":
            cb.onReady(msg.pty_id);
            break;
          case "exit":
            cb.onExit(msg.code);
            break;
          case "reconnected":
            cb.onReconnected(msg.scrollback, msg.alive);
            break;
          case "error":
            cb.onError(msg.message);
            break;
        }
      } catch {
        optionsRef.current.onError("Failed to parse terminal message");
      }
    };

    ws.onerror = () => {
      if (!intentionalClose) {
        toast.error("Terminal WebSocket connection failed");
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (!intentionalClose) {
        optionsRef.current.onError(
          "Connection lost. Terminal may still be running — reopen to reconnect.",
        );
      }
    };

    return () => {
      intentionalClose = true;
      wsRef.current = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, "unmount");
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = useCallback((data: string) => {
    sendJson(wsRef.current, { type: "write", data });
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    sendJson(wsRef.current, { type: "resize", cols, rows });
  }, []);

  const kill = useCallback(() => {
    sendJson(wsRef.current, { type: "kill" });
  }, []);

  return { write, resize, kill, isConnected };
}
