import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "./safe-url";

describe("isSafeExternalUrl", () => {
  it("accepts credential-free https URLs to a real host", () => {
    expect(isSafeExternalUrl("https://example.com/path")).toBe(true);
    expect(isSafeExternalUrl("https://ngrok.com/docs")).toBe(true);
  });

  it("rejects non-https, credentials, loopback, and garbage", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("https://user:pass@example.com")).toBe(false);
    expect(isSafeExternalUrl("https://localhost:5005")).toBe(false);
    expect(isSafeExternalUrl("https://127.0.0.1/x")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
