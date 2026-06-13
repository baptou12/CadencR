import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { requiredRecord, requiredString } from "./browser-arg-validation";
import type { BrowserBridgeResult } from "./browser-mcp-dispatch";

export interface BrowserBridgeRequestPayload {
  tool_name: string;
  args: Record<string, unknown>;
}

export interface BrowserBridgeHandle {
  url: string;
  token: string;
  stop: () => Promise<void>;
}

export interface BrowserBridgeServerOptions {
  token?: string;
  dispatch: (toolName: string, args: Record<string, unknown>) => Promise<BrowserBridgeResult>;
}

export async function startBrowserBridgeServer(
  options: BrowserBridgeServerOptions,
): Promise<BrowserBridgeHandle> {
  const token = options.token ?? crypto.randomBytes(32).toString("base64url");
  const server = http.createServer((request, response) => {
    void handleRequest(request, response, token, options.dispatch);
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser bridge did not bind.");
  return {
    url: `http://127.0.0.1:${address.port}/browser-bridge`,
    token,
    stop: () => close(server),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  dispatch: BrowserBridgeServerOptions["dispatch"],
): Promise<void> {
  if (request.method !== "POST" || request.url !== "/browser-bridge") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }
  try {
    const result = await dispatchBrowserBridgePayload(
      request.headers.authorization ?? "",
      token,
      await readBody(request),
      dispatch,
    );
    sendJson(response, result.status, result.payload);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function dispatchBrowserBridgePayload(
  authorization: string,
  token: string,
  rawBody: string,
  dispatch: BrowserBridgeServerOptions["dispatch"],
): Promise<{ status: number; payload: unknown }> {
  if (authorization !== `Bearer ${token}`) {
    return { status: 401, payload: { error: "Unauthorized" } };
  }
  const payload = parsePayload(rawBody);
  const result = await dispatch(payload.tool_name, payload.args);
  return { status: 200, payload: result };
}

function parsePayload(raw: string): BrowserBridgeRequestPayload {
  const value: unknown = JSON.parse(raw || "{}");
  const record = requiredRecord(value, "request object");
  return {
    tool_name: requiredString(record.tool_name, "tool_name"),
    args: requiredRecord(record.args, "args object"),
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Request body too large."));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function listen(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
