import { describe, expect, it } from "vitest";
import { rendererCsp, resolveRendererCspDevelopment } from "./csp";

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

  it("allows the configured development endpoints instead of the default ports", () => {
    const development = resolveRendererCspDevelopment({
      VITE_API_URL: "http://127.0.0.1:5100",
      VITE_FRONTEND_PORT: "1421",
    });
    const csp = rendererCsp(false, development);

    expect(development.frontendPort).toBe(1421);
    expect(csp).toContain("http://127.0.0.1:5100");
    expect(csp).toContain("ws://127.0.0.1:5100");
    expect(csp).toContain("http://127.0.0.1:1421");
    expect(csp).toContain("ws://127.0.0.1:1421");
    expect(csp).not.toContain("127.0.0.1:5005");
    expect(csp).not.toContain("127.0.0.1:1420");
  });

  it("ignores configured development endpoints in production", () => {
    const csp = rendererCsp(true, {
      apiUrl: "https://api.example.com",
      rendererUrl: "https://app.example.com",
    });

    expect(csp).not.toContain("example.com");
    expect(csp).toContain("http://127.0.0.1:5004");
  });
});
