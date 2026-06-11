import { redactBrowserHeaders } from "./browser-policy";

export class BrowserNetworkHeadersCache {
  private readonly headersByRequestId = new Map<
    string,
    Record<string, string | string[] | undefined>
  >();

  remember(
    requestId: string | number,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    this.headersByRequestId.set(String(requestId), redactBrowserHeaders(headers));
  }

  take(requestId: string | number): Record<string, string | string[] | undefined> {
    const key = String(requestId);
    const headers = this.headersByRequestId.get(key) ?? {};
    this.headersByRequestId.delete(key);
    return headers;
  }
}

export function networkFailureReason(details: { error?: string }): string | undefined {
  if (!details.error || details.error === "net::OK") return undefined;
  return details.error;
}
