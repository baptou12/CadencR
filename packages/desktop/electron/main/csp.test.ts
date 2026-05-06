import { describe, expect, it } from "vitest";
import { rendererCsp } from "./csp";

describe("rendererCsp", () => {
  it("uses a hardened production policy", () => {
    const csp = rendererCsp(true);

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("127.0.0.1:5005");
    expect(csp).not.toContain("127.0.0.1:1420");
    expect(csp).toContain("http://127.0.0.1:5004");
    expect(csp).toContain("object-src 'none'");
  });

  it("allows Vite dev endpoints only for development", () => {
    const csp = rendererCsp(false);

    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("http://127.0.0.1:5005");
    expect(csp).toContain("ws://127.0.0.1:1420");
  });
});
