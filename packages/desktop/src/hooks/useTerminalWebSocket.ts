import { useEffect, useRef, useState, useCallback } from "react";
import { createWsConnection, type WsConnection } from "@/lib/ws-connection";
import { getTerminalWsUrl, getWsProtocols } from "@/lib/ws-url";
import {
  scheduleReconnect,
  registerReconnector,
  unregisterReconnector,
  resetReconnectDelay,
} from "@/lib/ws-reconnect";
import { useConnectionStatusStore } from "@/stores/connection-status-store";

// -- Message types matching Rust backend protocol --

interface TerminalMessageData {
  type: "data";
  data: string;
}

interface TerminalMessageReady {
  type: "ready";
  pty_id: string;
  cwd: string;
}

interface TerminalMessageExit {
  type: "exit";
  code: number;
}

interface TerminalMessageReconnected {
  type: "reconnected";
  scrollback: string;
  alive: boolean;
  cwd: string | null;
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
  /**
   * Explicit cwd to spawn the PTY in. The backend validates it against the
   * feature's worktree/project path and uses it verbatim when valid; otherwise
   * it falls back to its own DB lookup. Lets the UI pin a fresh PTY to the
   * directory it just observed (e.g. on "Restart here") without depending on
   * a second snapshot read.
   */
  requestedCwd?: string;
  onData: (data: string) => void;
  onExit: (code: number) => void;
  onReady: (ptyId: string, cwd: string) => void;
  onReconnected: (scrollback: string, alive: boolean, cwd: string | null) => void;
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

interface BuildOptions {
  featureId?: number;
  projectId?: number;
  ptyId?: string;
  requestedCwd?: string;
}

function buildWsUrl(options: BuildOptions, cols?: number, rows?: number): string {
  const params = new URLSearchParams();

  if (options.ptyId) {
    params.set("pty_id", options.ptyId);
  } else {
    if (options.featureId != null) params.set("feature_id", String(options.featureId));
    if (options.projectId != null) params.set("project_id", String(options.projectId));
    if (cols != null) params.set("cols", String(cols));
    if (rows != null) params.set("rows", String(rows));
    if (options.requestedCwd) params.set("cwd", options.requestedCwd);
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

  // Latest known PTY id. Seeded from `options.ptyId` (when reconnecting to
  // a known PTY) and overwritten when the backend sends `ready` /
  // `reconnected`. The reconnector reads this so it always reattaches
  // to the live PTY rather than spawning a fresh shell on every blip.
  const latestPtyIdRef = useRef<string | undefined>(options.ptyId);
  // Last fitted dimensions — needed when reconnecting without a known
  // PTY (fresh fallback, e.g. after a >300s grace expiry the backend
  // may still need cols/rows to spawn a new shell).
  const dimsRef = useRef<{ cols: number; rows: number } | null>(null);

  // Stable per-instance key for the ws-reconnect registry. Random suffix
  // because the same featureId could host multiple terminal panes.
  const reconnectKey = useRef(`terminal:${crypto.randomUUID()}`).current;

  const doConnect = useCallback(
    (cols: number, rows: number) => {
      dimsRef.current = { cols, rows };

      // Tear down previous connection if any.
      connRef.current?.close(1000, "reconnect");

      // Always prefer the latest known PTY id over the prop — `optionsRef`
      // may still be holding the original `existingPtyId`, but a freshly-
      // spawned PTY's id lives only in `latestPtyIdRef`.
      const buildOpts: BuildOptions = {
        featureId: optionsRef.current.featureId,
        projectId: optionsRef.current.projectId,
        requestedCwd: optionsRef.current.requestedCwd,
        ptyId: latestPtyIdRef.current,
      };

      const conn = createWsConnection({
        url: buildWsUrl(buildOpts, cols, rows),
        protocols: getWsProtocols(),
        onOpen: () => {
          setIsConnected(true);
          resetReconnectDelay(reconnectKey);
          useConnectionStatusStore.getState().reportSource(reconnectKey, "connected");
        },
        onMessage: (data) => {
          try {
            const msg = JSON.parse(data) as TerminalMessage;
            const cb = optionsRef.current;
            switch (msg.type) {
              case "data":
                cb.onData(msg.data);
                break;
              case "ready":
                latestPtyIdRef.current = msg.pty_id;
                cb.onReady(msg.pty_id, msg.cwd);
                break;
              case "exit":
                cb.onExit(msg.code);
                break;
              case "reconnected":
                cb.onReconnected(msg.scrollback, msg.alive, msg.cwd);
                if (!msg.alive) {
                  // PTY is gone (>300s grace). Drop the stored id so any
                  // future reconnect would spawn fresh rather than
                  // hammering an empty handle.
                  latestPtyIdRef.current = undefined;
                }
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
          // `intentional` is true when our own `close()` flipped the flag —
          // covers both explicit reconnect and unmount cleanup, so no
          // separate "unmounted" guard is needed here.
          if (intentional) return;
          useConnectionStatusStore
            .getState()
            .reportSource(reconnectKey, "reconnecting", "Terminal WebSocket error");
        },
        onClose: (intentional) => {
          setIsConnected(false);
          if (intentional) return;
          // Surface to the user inside the xterm buffer + global indicator,
          // then schedule a backoff reconnect. The backend keeps PTYs
          // alive for 300s so most reconnects within that window will
          // resume cleanly via the `?pty_id=` path.
          optionsRef.current.onError("Connection lost. Reconnecting…");
          useConnectionStatusStore
            .getState()
            .reportSource(reconnectKey, "reconnecting", "Terminal WebSocket dropped");
          scheduleReconnect(reconnectKey, () => {
            const dims = dimsRef.current;
            if (dims) doConnect(dims.cols, dims.rows);
          });
        },
      });

      connRef.current = conn;
    },
    [reconnectKey],
  );

  const connect = useCallback(
    (cols: number, rows: number) => {
      doConnect(cols, rows);
      // Register so the watchdog can force this terminal to reconnect on
      // wake/online without waiting for TCP-level close detection.
      registerReconnector(reconnectKey, () => {
        const dims = dimsRef.current;
        if (dims) doConnect(dims.cols, dims.rows);
      });
    },
    [doConnect, reconnectKey],
  );

  // Clean up WebSocket + reconnect registry on unmount. The WS connection
  // itself flips `intentional=true` inside `close()`, which gates the
  // close/error callbacks from running stale React state — so no
  // separate "is the hook still mounted" guard is needed.
  useEffect(() => {
    return () => {
      connRef.current?.close(1000, "unmount");
      unregisterReconnector(reconnectKey);
      useConnectionStatusStore.getState().clearSource(reconnectKey);
    };
  }, [reconnectKey]);

  const write = useCallback((data: string) => {
    connRef.current?.sendJson({ type: "write", data });
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    dimsRef.current = { cols, rows };
    connRef.current?.sendJson({ type: "resize", cols, rows });
  }, []);

  const kill = useCallback(() => {
    connRef.current?.sendJson({ type: "kill" });
  }, []);

  return { connect, write, resize, kill, isConnected };
}
