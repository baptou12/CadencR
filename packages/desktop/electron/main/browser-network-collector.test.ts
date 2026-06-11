import { describe, expect, it, vi } from "vitest";
import { BrowserNetworkCollector } from "./browser-network-collector";
import type { BrowserNetworkEntry } from "./browser-types";

type CollectedEntry = Omit<BrowserNetworkEntry, "tabId">;

interface MockSession {
  handlers: Record<string, (details: unknown) => void>;
  webRequest: {
    onBeforeSendHeaders: ReturnType<typeof vi.fn>;
    onCompleted: ReturnType<typeof vi.fn>;
    onErrorOccurred: ReturnType<typeof vi.fn>;
  };
}

function mockSession(): MockSession {
  const handlers: Record<string, (details: unknown) => void> = {};
  return {
    handlers,
    webRequest: {
      onBeforeSendHeaders: vi.fn((cb: (d: unknown) => void) => (handlers.beforeSend = cb)),
      onCompleted: vi.fn((cb: (d: unknown) => void) => (handlers.completed = cb)),
      onErrorOccurred: vi.fn((cb: (d: unknown) => void) => (handlers.error = cb)),
    },
  };
}

function asSession(mock: MockSession): Electron.Session {
  return mock as unknown as Electron.Session;
}

describe("BrowserNetworkCollector", () => {
  it("emits an entry for completed requests, keyed by webContents id", () => {
    const seen: Array<{ id: number; entry: CollectedEntry }> = [];
    const collector = new BrowserNetworkCollector((id, entry) => seen.push({ id, entry }));
    const session = mockSession();
    collector.ensure(asSession(session));

    session.handlers.completed({
      id: 1,
      webContentsId: 7,
      method: "GET",
      url: "http://localhost/api",
      statusCode: 200,
      responseHeaders: {},
      resourceType: "xhr",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe(7);
    expect(seen[0].entry.status).toBe(200);
    expect(seen[0].entry.url).toBe("http://localhost/api");
  });

  it("skips requests that cannot be attributed to a tab", () => {
    const seen: CollectedEntry[] = [];
    const collector = new BrowserNetworkCollector((_id, entry) => seen.push(entry));
    const session = mockSession();
    collector.ensure(asSession(session));

    session.handlers.error({
      id: 2,
      method: "GET",
      url: "http://localhost/y",
      error: "net::ERR_FAILED",
      resourceType: "xhr",
    });

    expect(seen).toHaveLength(0);
  });

  it("instruments each session only once", () => {
    const collector = new BrowserNetworkCollector(() => undefined);
    const session = mockSession();
    collector.ensure(asSession(session));
    collector.ensure(asSession(session));
    expect(session.webRequest.onCompleted).toHaveBeenCalledTimes(1);
  });
});
