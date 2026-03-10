import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { CliNotFoundError } from "../effect/errors";

vi.mock("./cli-discovery", () => ({
  discoverClaudeCli: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock("../../shared/models", () => ({
  CLAUDE_MODELS: [
    { id: "claude-opus-4-5-20251001", label: "Claude Opus 4.5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
}));

import { discoverClaudeCli } from "./cli-discovery";

const mockDiscoverCli = vi.mocked(discoverClaudeCli);

describe("fetchAvailableModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state (cache) by re-importing
    vi.resetModules();
  });

  it("returns static models if CLI not found", async () => {
    mockDiscoverCli.mockReturnValue(Effect.fail(new CliNotFoundError({ searchedPaths: [] })));

    // Re-import to get fresh module state
    const { fetchAvailableModels } = await import("./available-models");
    const result = await fetchAvailableModels();

    expect(result).toEqual([
      { id: "claude-opus-4-5-20251001", label: "Claude Opus 4.5" },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ]);
  });

  it("returns static models on SDK error", async () => {
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));
    mockQuery.mockImplementation(() => { throw new Error("SDK error"); });

    const { fetchAvailableModels } = await import("./available-models");
    const result = await fetchAvailableModels();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("fetches models from SDK on system init event", async () => {
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const mockSupportedModels = vi.fn().mockResolvedValue([
      { value: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet" },
    ]);

    function makeQueryIterable() {
      const iterable = {
        [Symbol.asyncIterator]() {
          let done = false;
          return {
            async next() {
              if (!done) {
                done = true;
                return { value: { type: "system", subtype: "init" }, done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
        supportedModels: mockSupportedModels,
      };
      return iterable;
    }

    mockQuery.mockReturnValue(makeQueryIterable());

    const { fetchAvailableModels } = await import("./available-models");
    const result = await fetchAvailableModels();

    expect(result).toEqual([
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    ]);
  });
});
