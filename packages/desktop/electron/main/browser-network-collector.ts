import { randomUUID } from "node:crypto";
import type { Session } from "electron";
import { redactBrowserHeaders } from "./browser-policy";
import { BrowserNetworkHeadersCache, networkFailureReason } from "./browser-network-headers";
import type { BrowserNetworkEntry } from "./browser-types";

type NetworkDetails = Electron.OnCompletedListenerDetails | Electron.OnErrorOccurredListenerDetails;

// Instruments Electron sessions once each and turns completed/failed requests
// into bounded, header-redacted entries. The owning manager maps the
// webContents id back to a tab and stores the entry.
export class BrowserNetworkCollector {
  private readonly instrumented = new WeakSet<Session>();
  private readonly headers = new BrowserNetworkHeadersCache();

  constructor(
    private readonly onEntry: (
      webContentsId: number,
      entry: Omit<BrowserNetworkEntry, "tabId">,
    ) => void,
  ) {}

  ensure(session: Session): void {
    if (this.instrumented.has(session)) return;
    this.instrumented.add(session);
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      this.headers.remember(details.id, details.requestHeaders);
      callback({ requestHeaders: details.requestHeaders });
    });
    session.webRequest.onCompleted((details) => this.record(details));
    session.webRequest.onErrorOccurred((details) => this.record(details));
  }

  private record(details: NetworkDetails): void {
    const webContentsId = details.webContentsId;
    if (webContentsId === undefined) return;
    const response = "statusCode" in details ? details : null;
    this.onEntry(webContentsId, {
      id: randomUUID(),
      method: details.method,
      url: details.url,
      status: response?.statusCode,
      requestHeaders: this.headers.take(details.id),
      responseHeaders: redactBrowserHeaders(response?.responseHeaders ?? {}),
      resourceType: details.resourceType,
      timestamp: new Date().toISOString(),
      failureReason: networkFailureReason(details),
    });
  }
}
