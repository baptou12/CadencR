/**
 * Tests for the SlashCommands Effect service.
 *
 * Tests the per-cwd cache (5-min TTL), Deferred-based inflight deduplication,
 * acquireRelease cleanup (no double-close), active query path, and CLI fallback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Fiber, Duration } from "effect";
import { CliNotFoundError } from "../../../effect/errors";
import { SlashCommands, SlashCommandsLive } from "../SlashCommands";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../../agents/cli-discovery", () => ({
  discoverClaudeCli: vi.fn(),
}));
vi.mock("../../../agents/sdk-client", () => ({
  getSdkClient: vi.fn(),
}));

import { discoverClaudeCli } from "../../../agents/cli-discovery";
import { getSdkClient } from "../../../agents/sdk-client";

const mockDiscoverCli = vi.mocked(discoverClaudeCli);
const mockGetSdkClient = vi.mocked(getSdkClient);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Run an Effect against the SlashCommandsLive layer */
function runTest<A, E>(
  effect: Effect.Effect<A, E, SlashCommands>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, SlashCommandsLive));
}

/** Build a mock query object */
function makeMockQuery(commands: Array<{ name: string; description: string; argumentHint?: string }>) {
  const close = vi.fn();
  const supportedCommands = vi.fn().mockResolvedValue(commands);
  const queryObj = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<unknown>>(() => {}) };
    },
    supportedCommands,
    close,
    interrupt: vi.fn(),
    setPermissionMode: vi.fn(),
  };
  return { queryObj, close, supportedCommands };
}

const FIBER_START_DELAY = Duration.millis(20);

// ---------------------------------------------------------------------------
// Active subprocess path
// ---------------------------------------------------------------------------

describe("active query path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns commands from active query + CUSTOM_COMMANDS", async () => {
    const { queryObj, supportedCommands } = makeMockQuery([
      { name: "/fix", description: "Fix issues" },
    ]);

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/project", queryObj);
      }),
    );

    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
      { name: "/fix", description: "Fix issues", argumentHint: undefined },
    ]);
    expect(supportedCommands).toHaveBeenCalledOnce();
    // SDK client should NOT have been called — used activeQuery directly
    expect(mockGetSdkClient).not.toHaveBeenCalled();
  });

  it("falls back to [] when active query throws", async () => {
    const activeQuery = {
      supportedCommands: vi.fn().mockRejectedValue(new Error("subprocess died")),
    };

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/project", activeQuery);
      }),
    );

    // CUSTOM_COMMANDS only — no SDK commands
    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
    ]);
  });

  it("caches result from active query for subsequent cache-hit requests", async () => {
    const { queryObj, supportedCommands } = makeMockQuery([
      { name: "/test", description: "Run tests" },
    ]);

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        // First call — uses active query and populates cache
        yield* svc.getCommands("/project", queryObj);
        // Second call — no active query, should hit cache
        return yield* svc.getCommands("/project");
      }),
    );

    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
      { name: "/test", description: "Run tests", argumentHint: undefined },
    ]);
    // supportedCommands only called once (first call)
    expect(supportedCommands).toHaveBeenCalledOnce();
    expect(mockGetSdkClient).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cache hit within TTL
// ---------------------------------------------------------------------------

describe("cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached commands on second call within TTL", async () => {
    const { queryObj, supportedCommands } = makeMockQuery([
      { name: "/continue", description: "Continue" },
    ]);
    mockGetSdkClient.mockResolvedValue({ query: vi.fn().mockReturnValue(queryObj) } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const [first, second] = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        const r1 = yield* svc.getCommands("/cwd");
        // Second call within TTL — should hit cache, not call SDK again
        const r2 = yield* svc.getCommands("/cwd");
        return [r1, r2] as const;
      }),
    );

    expect(first).toEqual(second);
    // supportedCommands should only be called once (first fetch)
    expect(supportedCommands).toHaveBeenCalledOnce();
    expect(mockGetSdkClient).toHaveBeenCalledOnce();
  });

  it("uses separate cache entries per cwd", async () => {
    const { queryObj: qA, supportedCommands: scA } = makeMockQuery([
      { name: "/fix", description: "Fix" },
    ]);
    const { queryObj: qB, supportedCommands: scB } = makeMockQuery([
      { name: "/test", description: "Test" },
    ]);

    let callCount = 0;
    mockGetSdkClient.mockResolvedValue({
      query: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? qA : qB;
      }),
    } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const [rA, rB] = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        const rA = yield* svc.getCommands("/project-a");
        const rB = yield* svc.getCommands("/project-b");
        return [rA, rB] as const;
      }),
    );

    expect(rA).toContainEqual({ name: "/fix", description: "Fix", argumentHint: undefined });
    expect(rB).toContainEqual({ name: "/test", description: "Test", argumentHint: undefined });
    expect(scA).toHaveBeenCalledOnce();
    expect(scB).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Cache miss — temporary query
// ---------------------------------------------------------------------------

describe("cache miss — temporary query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns temporary query on cache miss and caches result", async () => {
    const { queryObj, close, supportedCommands } = makeMockQuery([
      { name: "/commit", description: "Commit changes" },
    ]);
    mockGetSdkClient.mockResolvedValue({ query: vi.fn().mockReturnValue(queryObj) } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/myproject");
      }),
    );

    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
      { name: "/commit", description: "Commit changes", argumentHint: undefined },
    ]);
    expect(supportedCommands).toHaveBeenCalledOnce();
    // acquireRelease must call close() exactly once
    expect(close).toHaveBeenCalledOnce();
  });

  it("close() is called even when supportedCommands() throws (acquireRelease)", async () => {
    const close = vi.fn();
    const failingQuery = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<unknown>>(() => {}) };
      },
      supportedCommands: vi.fn().mockRejectedValue(new Error("CLI crashed")),
      close,
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };
    mockGetSdkClient.mockResolvedValue({
      query: vi.fn().mockReturnValue(failingQuery),
    } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/crashproject");
      }),
    );

    // Graceful fallback — only CUSTOM_COMMANDS
    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
    ]);
    // close() must still be called despite the error
    expect(close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Concurrent request deduplication
// ---------------------------------------------------------------------------

describe("concurrent deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates concurrent requests for the same cwd", async () => {
    // Use a resolver to control when supportedCommands() resolves
    let resolveCommands!: (val: Array<{ name: string; description: string }>) => void;
    const commandsPromise = new Promise<Array<{ name: string; description: string }>>(
      (res) => { resolveCommands = res; },
    );

    const close = vi.fn();
    const supportedCommands = vi.fn().mockReturnValue(commandsPromise);
    const queryObj = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<unknown>>(() => {}) };
      },
      supportedCommands,
      close,
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };
    mockGetSdkClient.mockResolvedValue({
      query: vi.fn().mockReturnValue(queryObj),
    } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const [r1, r2] = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;

        // Fork two concurrent requests for the same cwd
        const fiber1 = yield* Effect.fork(svc.getCommands("/shared-project"));
        const fiber2 = yield* Effect.fork(svc.getCommands("/shared-project"));

        // Give fibers time to start and register
        yield* Effect.sleep(FIBER_START_DELAY);

        // Resolve the backing promise
        resolveCommands([{ name: "/merge", description: "Merge branches" }]);

        const r1 = yield* Fiber.join(fiber1);
        const r2 = yield* Fiber.join(fiber2);
        return [r1, r2] as const;
      }),
    );

    // Both results should be identical
    const expected = [
      { name: "clear", description: "Clear conversation context and start fresh" },
      { name: "/merge", description: "Merge branches", argumentHint: undefined },
    ];
    expect(r1).toEqual(expected);
    expect(r2).toEqual(expected);

    // Only one temporary subprocess was spawned (dedup worked)
    expect(supportedCommands).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Interruption cleanup
// ---------------------------------------------------------------------------

describe("interruption cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails the Deferred and cleans up inflight when owner fiber is interrupted", async () => {
    // Never-resolving supportedCommands keeps the owner blocked indefinitely
    let resolveCommands!: (val: Array<{ name: string; description: string }>) => void;
    const commandsPromise = new Promise<Array<{ name: string; description: string }>>(
      (res) => { resolveCommands = res; },
    );

    const close = vi.fn();
    const supportedCommands = vi.fn().mockReturnValue(commandsPromise);
    const queryObj = {
      [Symbol.asyncIterator]() {
        return { next: () => new Promise<IteratorResult<unknown>>(() => {}) };
      },
      supportedCommands,
      close,
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
    };
    mockGetSdkClient.mockResolvedValue({
      query: vi.fn().mockReturnValue(queryObj),
    } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;

        // Fork the owner — it will block waiting for commandsPromise to resolve
        const ownerFiber = yield* Effect.fork(svc.getCommands("/interrupt-test"));

        // Give the owner time to register in the inflight map
        yield* Effect.sleep(FIBER_START_DELAY);

        // Fork a waiter — it will wait on the same Deferred
        const waiterFiber = yield* Effect.fork(svc.getCommands("/interrupt-test"));

        // Give the waiter time to register
        yield* Effect.sleep(FIBER_START_DELAY);

        // Interrupt the owner fiber — this should trigger onInterrupt which
        // fails the Deferred and ensuring which removes the inflight entry
        yield* Fiber.interrupt(ownerFiber);

        // Waiter should unblock with [] (Deferred.fail → catchAll fallback)
        // rather than hanging indefinitely
        const waiterResult = yield* Fiber.join(waiterFiber);
        expect(waiterResult).toEqual([
          { name: "clear", description: "Clear conversation context and start fresh" },
        ]);

        // After interruption the inflight map entry is cleaned up — a fresh
        // request should spawn a new fetch, not wait on the old dead Deferred.
        // Swap in a mock that resolves immediately.
        const { queryObj: freshQuery } = makeMockQuery([
          { name: "/fresh", description: "Fresh command" },
        ]);
        mockGetSdkClient.mockResolvedValue({
          query: vi.fn().mockReturnValue(freshQuery),
        } as any);
        // Resolve the old promise so no dangling Promises remain in the test
        resolveCommands([]);

        const freshResult = yield* svc.getCommands("/interrupt-test");
        expect(freshResult).toContainEqual({
          name: "clear",
          description: "Clear conversation context and start fresh",
        });
        expect(freshResult).toContainEqual({
          name: "/fresh",
          description: "Fresh command",
          argumentHint: undefined,
        });
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Missing CLI — graceful fallback
// ---------------------------------------------------------------------------

describe("missing CLI fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only CUSTOM_COMMANDS when CLI is not found", async () => {
    mockDiscoverCli.mockReturnValue(Effect.fail(new CliNotFoundError({ searchedPaths: [] })));
    mockGetSdkClient.mockResolvedValue({ query: vi.fn() } as any);

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/no-cli-project");
      }),
    );

    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// CUSTOM_COMMANDS always included
// ---------------------------------------------------------------------------

describe("CUSTOM_COMMANDS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always includes 'clear' command regardless of SDK results", async () => {
    const { queryObj } = makeMockQuery([]);
    mockGetSdkClient.mockResolvedValue({ query: vi.fn().mockReturnValue(queryObj) } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/empty-commands-project");
      }),
    );

    expect(result).toEqual([
      { name: "clear", description: "Clear conversation context and start fresh" },
    ]);
  });

  it("prepends CUSTOM_COMMANDS before SDK commands", async () => {
    const { queryObj } = makeMockQuery([
      { name: "/fix", description: "Fix issues" },
    ]);
    mockGetSdkClient.mockResolvedValue({ query: vi.fn().mockReturnValue(queryObj) } as any);
    mockDiscoverCli.mockReturnValue(Effect.succeed({ path: "/usr/bin/claude", source: "settings" }));

    const result = await runTest(
      Effect.gen(function* () {
        const svc = yield* SlashCommands;
        return yield* svc.getCommands("/myproject2");
      }),
    );

    expect(result[0].name).toBe("clear");
    expect(result[1].name).toBe("/fix");
  });
});

// ---------------------------------------------------------------------------
// SlashCommandError type verification
// ---------------------------------------------------------------------------

describe("error types", () => {
  it("SlashCommandError has correct _tag", async () => {
    const { SlashCommandError } = await import("../../errors");
    const err = new SlashCommandError({ message: "test error" });
    expect(err._tag).toBe("SlashCommandError");
    expect(err.message).toBe("test error");
  });

  it("SlashCommandError can carry a cause", async () => {
    const { SlashCommandError } = await import("../../errors");
    const cause = new Error("underlying");
    const err = new SlashCommandError({ message: "wrapped", cause });
    expect(err.cause).toBe(cause);
  });
});
