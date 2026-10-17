import { resolveApiBaseUrlSync } from "@/api/client";

import { BrokerError, errorFromResponse, toBrokerError } from "./broker-errors";
import { PLUGIN_TOKEN_HEADER, type GrantHolder } from "./broker-grant";

export interface PluginHttpRequest {
  method: string;
  /** Service path starting with `/api/`. */
  path: string;
  query?: Record<string, string>;
  /** Extra request headers (never the token: that one is set here). */
  headers?: Record<string, string>;
  body?: BodyInit;
  contentType?: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Requests to the service authenticated with the instance's grant. */
export interface PluginHttp {
  /** Resolves every HTTP status; rejects only on transport failure. */
  send(request: PluginHttpRequest): Promise<Response>;
  /** `send`, but a non-2xx status rejects with the service's error. */
  sendOk(request: PluginHttpRequest): Promise<Response>;
}

function urlOf(baseUrl: string, path: string, query?: Record<string, string>): string {
  const search = query ? new URLSearchParams(query).toString() : "";
  return search === "" ? `${baseUrl}${path}` : `${baseUrl}${path}?${search}`;
}

export function createPluginHttp(
  grant: GrantHolder,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  baseUrl: () => string = resolveApiBaseUrlSync,
): PluginHttp {
  const attempt = async (request: PluginHttpRequest, token: string): Promise<Response> => {
    const headers: Record<string, string> = { ...request.headers, [PLUGIN_TOKEN_HEADER]: token };
    if (request.contentType) headers["content-type"] = request.contentType;
    try {
      return await fetchImpl(urlOf(baseUrl(), request.path, request.query), {
        method: request.method,
        headers,
        body: request.body,
      });
    } catch (error) {
      // `fetch` rejects with a TypeError when the service cannot be reached.
      if (error instanceof TypeError) throw new BrokerError("DISCONNECTED", error.message);
      throw toBrokerError(error);
    }
  };
  const send = async (request: PluginHttpRequest): Promise<Response> => {
    const token = await grant.token();
    const response = await attempt(request, token);
    if (response.status !== 401) return response;
    // The grant was revoked (manifest change, disable) or expired early:
    // re-mint once and retry. A second 401 is the answer.
    grant.invalidate(token);
    return attempt(request, await grant.token());
  };
  return {
    send,
    async sendOk(request) {
      const response = await send(request);
      if (!response.ok) throw await errorFromResponse(response);
      return response;
    },
  };
}
