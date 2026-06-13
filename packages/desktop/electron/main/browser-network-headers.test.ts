import { describe, expect, it } from "vitest";
import { BrowserNetworkHeadersCache, networkFailureReason } from "./browser-network-headers";

describe("BrowserNetworkHeadersCache", () => {
  it("returns redacted request headers once for a completed request", () => {
    const cache = new BrowserNetworkHeadersCache();
    cache.remember("request-1", {
      Authorization: "Bearer secret",
      Accept: "application/json",
    });

    expect(cache.take("request-1")).toEqual({
      Authorization: "[redacted]",
      Accept: "application/json",
    });
    expect(cache.take("request-1")).toEqual({});
  });

  it("does not mark completed net::OK requests as failures", () => {
    expect(networkFailureReason({ error: "net::OK" })).toBeUndefined();
    expect(networkFailureReason({ error: "net::ERR_FAILED" })).toBe("net::ERR_FAILED");
  });
});
