import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./cli-discovery", () => ({
  discoverClaudeCli: vi.fn(),
}));
vi.mock("./sdk-client", () => ({
  getSdkClient: vi.fn(),
}));
import { discoverClaudeCli } from "./cli-discovery";
import { getSdkClient } from "./sdk-client";

const mockDiscoverCli = vi.mocked(discoverClaudeCli);
const mockGetSdkClient = vi.mocked(getSdkClient);
const mockGetActiveProcess = vi.fn();

describe("getSupportedCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("uses active subprocess if available", async () => {
    const mockSupportedCommands = vi.fn().mockResolvedValue([
      { name: "/continue", description: "Continue" },
    ]);
    mockGetActiveProcess.mockReturnValue({
      query: { supportedCommands: mockSupportedCommands },
      status: "running",
    } as any);

    const { getSupportedCommands: fn } = await import("./slash-commands");
    const result = await fn("sub1", "/cwd", mockGetActiveProcess);

    expect(result).toEqual([{ name: "/continue", description: "Continue", argumentHint: undefined }]);
    expect(mockSupportedCommands).toHaveBeenCalled();
  });

  it("spawns temporary query when no active subprocess", async () => {
    mockGetActiveProcess.mockReturnValue(undefined);
    mockDiscoverCli.mockResolvedValue({ path: "/usr/bin/claude", source: "settings" });

    const mockClose = vi.fn();
    const mockSupportedCommands = vi.fn().mockResolvedValue([
      { name: "/fix", description: "Fix issues", argumentHint: "description" },
    ]);

    const mockQueryObj = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise(() => {}) };
      },
      supportedCommands: mockSupportedCommands,
      close: mockClose,
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };

    const mockClient = { query: vi.fn().mockReturnValue(mockQueryObj) };
    mockGetSdkClient.mockResolvedValue(mockClient as any);

    const { getSupportedCommands: fn } = await import("./slash-commands");
    const result = await fn(null, "/cwd2", mockGetActiveProcess);

    expect(result).toEqual([{ name: "/fix", description: "Fix issues", argumentHint: "description" }]);
    expect(mockClose).toHaveBeenCalled();
  });

  it("returns empty array when CLI not found", async () => {
    mockGetActiveProcess.mockReturnValue(undefined);
    mockDiscoverCli.mockResolvedValue(null);
    mockGetSdkClient.mockResolvedValue({ query: vi.fn() } as any);

    const { getSupportedCommands: fn } = await import("./slash-commands");
    const result = await fn(null, "/cwd3", mockGetActiveProcess);

    expect(result).toEqual([]);
  });

  it("skips subprocess if it is stopped", async () => {
    mockGetActiveProcess.mockReturnValue({
      query: { supportedCommands: vi.fn() },
      status: "stopped",
    } as any);
    mockDiscoverCli.mockResolvedValue(null);
    mockGetSdkClient.mockResolvedValue({ query: vi.fn() } as any);

    const { getSupportedCommands: fn } = await import("./slash-commands");
    const result = await fn("sub1", "/cwd", mockGetActiveProcess);

    expect(result).toEqual([]);
  });
});
