import { vi } from "vitest";

// Block the real Claude Agent SDK from ever being imported in tests.
// If any code path tries to reach the real SDK, it will throw immediately
// instead of silently spawning a subprocess and burning tokens.
vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  throw new Error(
    "Real @anthropic-ai/claude-agent-sdk was imported during tests! " +
      "Use setSdkClient() with createMockSdkClient() instead.",
  );
});

// Mock the electron module globally for main process tests
const mockElectron = {
  app: {
    getPath: (name: string) => `/tmp/productdevr-test/${name}`,
    getName: () => "ProductDevR",
    getVersion: () => "0.0.0-test",
    isReady: () => true,
    whenReady: () => Promise.resolve(),
  },
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows: vi.fn().mockReturnValue([]) }),
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
};
vi.mock("electron", () => ({
  ...mockElectron,
  default: mockElectron,
}));
