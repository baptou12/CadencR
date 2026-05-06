import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setDesktopBridgeOverrideForTests,
  clearDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";
import type { CadencrDesktopBridge } from "@/lib/desktop-bridge";
import {
  __resetRuntimeConfigForTests,
  getAuthTokenSync,
  preloadRuntimeConfig,
  resolveApiBaseUrlSync,
} from "./client";

function bridgeWithRuntime(
  runtimeConfig: CadencrDesktopBridge["runtimeConfig"],
): CadencrDesktopBridge {
  return {
    isElectron: true,
    runtimeConfig,
    readFileBase64: vi.fn(),
    onFileDrop: vi.fn(() => () => undefined),
    revealInFinder: vi.fn(),
    openExternal: vi.fn(),
    pickDirectory: vi.fn(),
    notifyPermission: vi.fn(),
    notify: vi.fn(),
    onNotificationClicked: vi.fn(() => () => undefined),
    onCloseRequested: vi.fn(() => () => undefined),
    confirmClose: vi.fn(),
    requestQuit: vi.fn(),
    setZoom: vi.fn(),
    currentTheme: vi.fn(),
    onThemeChange: vi.fn(() => () => undefined),
  };
}

describe("runtime config client", () => {
  beforeEach(() => {
    __resetRuntimeConfigForTests();
    vi.unstubAllEnvs();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    clearDesktopBridgeOverrideForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearDesktopBridgeOverrideForTests();
  });

  it("falls back to env base URL and token when runtime config is unavailable", async () => {
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:6123/");
    vi.stubEnv("VITE_API_TOKEN", "dev-token");
    const runtimeConfig = vi.fn(() => Promise.reject(new Error("runtime config unavailable")));
    setDesktopBridgeOverrideForTests(bridgeWithRuntime(runtimeConfig));

    await preloadRuntimeConfig();

    expect(resolveApiBaseUrlSync()).toBe("http://127.0.0.1:6123");
    expect(getAuthTokenSync()).toBe("dev-token");
  });

  it("coalesces a missing runtime auth token with the env fallback", async () => {
    vi.stubEnv("VITE_API_TOKEN", "dev-token");
    const runtimeConfig = vi.fn(() =>
      Promise.resolve({ baseUrl: "http://127.0.0.1:5005", authToken: null }),
    );
    setDesktopBridgeOverrideForTests(bridgeWithRuntime(runtimeConfig));

    await preloadRuntimeConfig();

    expect(resolveApiBaseUrlSync()).toBe("http://127.0.0.1:5005");
    expect(getAuthTokenSync()).toBe("dev-token");
  });
});
