/**
 * WebSocket implementation of `@codemirror/lsp-client`'s `Transport`
 * interface. Carries raw LSP JSON-RPC text frames between the renderer's
 * `LSPClient` and the Cadencr service's proxy at
 * `/api/lsp/sessions/:session_id/connect`.
 *
 * The transport is constructed *after* a session has been reserved via
 * `POST /api/lsp/sessions` and the WebSocket has reached `OPEN` — see
 * `connectLspWs` below. That two-step shape mirrors the backend's
 * single-use claim model so we can fail fast with HTTP error codes when a
 * language isn't supported, rather than completing a handshake just to
 * close it.
 *
 * @public
 */
import type { Transport } from "@codemirror/lsp-client";

import { resolveApiBaseUrlSync } from "@/api/client";
import { getWsProtocols } from "@/lib/ws-url";

/** How long we wait for the WebSocket to reach OPEN before treating the
 * connect as a failure. Long enough to absorb a single backend cold-start
 * (e.g. spawning rust-analyzer), short enough that a stuck connect doesn't
 * leave the cmd-click handler in limbo. */
const OPEN_TIMEOUT_MS = 10_000;

/** @public */
export class WebSocketLspTransport implements Transport {
  private readonly ws: WebSocket;
  private readonly handlers = new Set<(value: string) => void>();
  private closed = false;

  /** Use `connectLspWs(sessionId)` instead — that handles the open-promise. */
  constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", this.handleMessage);
    this.ws.addEventListener("close", this.handleClose);
    this.ws.addEventListener("error", this.handleClose);
  }

  send(message: string): void {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("LSP transport is not connected");
    }
    this.ws.send(message);
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  /** Explicitly close the transport. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ws.removeEventListener("message", this.handleMessage);
    this.ws.removeEventListener("close", this.handleClose);
    this.ws.removeEventListener("error", this.handleClose);
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(1000, "client");
    }
  }

  private handleMessage = (event: MessageEvent): void => {
    if (typeof event.data !== "string") {
      // The Rust proxy only emits text frames; binary would mean a bug.
      return;
    }
    for (const handler of this.handlers) {
      handler(event.data);
    }
  };

  private handleClose = (): void => {
    this.closed = true;
  };
}

/**
 * Build the WebSocket URL for a claimed LSP session. Mirrors the backend
 * route `GET /api/lsp/sessions/{session_id}/connect`.
 */
/** @public */
export function getLspWsUrl(sessionId: string): string {
  const base = resolveApiBaseUrlSync().replace(/^http/, "ws");
  return `${base}/api/lsp/sessions/${encodeURIComponent(sessionId)}/connect`;
}

/**
 * Open a WebSocket to the given LSP session and resolve to a connected
 * `Transport`. Rejects on error or timeout — the caller (cmd-click handler)
 * surfaces the failure as a toast.
 */
/** @public */
export async function connectLspWs(sessionId: string): Promise<WebSocketLspTransport> {
  const ws = new WebSocket(getLspWsUrl(sessionId), getWsProtocols());
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      ws.close();
      reject(new Error("LSP connect timed out"));
    }, OPEN_TIMEOUT_MS);
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (): void => {
      cleanup();
      reject(new Error("LSP connect failed"));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
  });
  return new WebSocketLspTransport(ws);
}
