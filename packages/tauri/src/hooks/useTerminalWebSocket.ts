import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { createWsConnection, type WsConnection } from "@/lib/ws-connection";
import { getTerminalWsUrl, getWsProtocols } from "@/lib/ws-url";

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

interface UseTerminalWebSocketReturn {
  /** Initiate the WebSocket connection. Call after terminal is fitted to pass accurate dimensions. */
  connect: (cols: number, rows: number) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  isConnected: boolean;
}

function buildWsUrl(options: UseTerminalWebSocketOptions, cols?: number, rows?: number): string {
  const params = new URLSearchParams();

  if (options.ptyId) {
    params.set("pty_id", options.ptyId);
  } else {
    if (options.featureId != null) params.set("feature_id", String(options.featureId));
    if (options.projectId != null) params.set("project_id", String(options.projectId));
    if (cols != null) params.set("cols", String(cols));
    if (rows != null) params.set("rows", String(rows));
  }

  return `${getTerminalWsUrl()}?${params.toString()}`;
}

export function useTerminalWebSocket(
  options: UseTerminalWebSocketOptions,
): UseTerminalWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const connRef = useRef<WsConnection | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      connRef.current?.close(1000, "unmount");
    };
  }, []);

  const connect = useCallback((cols: number, rows: number) => {
    // Tear down previous connection if any
    connRef.current?.close(1000, "reconnect");

    const conn = createWsConnection({
      url: buildWsUrl(optionsRef.current, cols, rows),
      protocols: getWsProtocols(),
      onOpen: () => setIsConnected(true),
      onMessage: (data) => {
        try {
          const msg = JSON.parse(data) as TerminalMessage;
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
      },
      onError: (intentional) => {
        if (!intentional) toast.error("Terminal WebSocket connection failed");
      },
      onClose: (intentional) => {
        setIsConnected(false);
        if (!intentional) {
          optionsRef.current.onError(
            "Connection lost. Terminal may still be running — reopen to reconnect.",
          );
        }
      },
    });

    connRef.current = conn;
  }, []);

  const write = useCallback((data: string) => {
    connRef.current?.sendJson({ type: "write", data });
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    connRef.current?.sendJson({ type: "resize", cols, rows });
  }, []);

  const kill = useCallback(() => {
    connRef.current?.sendJson({ type: "kill" });
  }, []);

  return { connect, write, resize, kill, isConnected };
}
