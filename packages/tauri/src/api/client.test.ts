import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import {
  __resetRuntimeConfigForTests,
  getAuthTokenSync,
  preloadRuntimeConfig,
  resolveApiBaseUrlSync,
} from "./client";

describe("runtime config client", () => {
  beforeEach(() => {
    __resetRuntimeConfigForTests();
    mocks.invoke.mockReset();
    vi.unstubAllEnvs();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to env base URL and token when runtime config is unavailable", async () => {
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:6123/");
    vi.stubEnv("VITE_API_TOKEN", "dev-token");
    mocks.invoke.mockRejectedValue(new Error("runtime config unavailable"));

    await preloadRuntimeConfig();

    expect(resolveApiBaseUrlSync()).toBe("http://127.0.0.1:6123");
    expect(getAuthTokenSync()).toBe("dev-token");
  });

  it("coalesces a missing runtime auth token with the env fallback", async () => {
    vi.stubEnv("VITE_API_TOKEN", "dev-token");
    mocks.invoke.mockResolvedValue({
      baseUrl: "http://127.0.0.1:5005",
      authToken: null,
    });

    await preloadRuntimeConfig();

    expect(resolveApiBaseUrlSync()).toBe("http://127.0.0.1:5005");
    expect(getAuthTokenSync()).toBe("dev-token");
  });
});
