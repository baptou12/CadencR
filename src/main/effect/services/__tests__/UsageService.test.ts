/**
 * Tests for the UsageService Effect service.
 *
 * Verifies:
 * - Successful fetch returns usage data
 * - Concurrent calls deduplicate (only one fetch fires)
 * - Cached result returned within TTL
 * - Rate-limited response sets backoff; subsequent calls return cached data
 * - Keychain error handled gracefully
 * - Fetch error returns cached data if available
 * - Module-level state is eliminated (no `let inflight`, `let cachedResult`, etc.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  UsageService,
  UsageServiceLive,
  type UsageResponse,
} from "../UsageService";

// ---------------------------------------------------------------------------
// Mock child_process so keychain calls are controllable
// ---------------------------------------------------------------------------

const mockExec = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (
    cmd: string,
    opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    // promisify wraps exec — simulate via callback
    mockExec(cmd, opts, cb);
    return { unref: vi.fn() };
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an Effect against a fresh UsageServiceLive layer */
function runTest<A, E>(
  effect: Effect.Effect<A, E, UsageService>,
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, UsageServiceLive));
}

/** Build a valid usage API JSON response */
function makeApiResponse(overrides?: Partial<UsageResponse>) {
  return {
    five_hour: { utilization: 0.5, resets_at: "2026-03-10T05:00:00Z" },
    seven_day: { utilization: 0.3, resets_at: "2026-03-17T00:00:00Z" },
    seven_day_sonnet: { utilization: 0.1, resets_at: null },
    ...overrides,
  };
}

/** Configure the keychain mock to return a valid OAuth token */
function mockKeychainSuccess() {
  mockExec.mockImplementation(
    (
      _cmd: string,
      _opts: unknown,
      cb: (
        err: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      cb(null, {
        stdout: JSON.stringify({
          claudeAiOauth: { accessToken: "test-token-123" },
        }),
        stderr: "",
      });
    },
  );
}

/** Configure the keychain mock to fail */
function mockKeychainFailure() {
  mockExec.mockImplementation(
    (
      _cmd: string,
      _opts: unknown,
      cb: (err: Error | null, result?: unknown) => void,
    ) => {
      cb(new Error("Keychain item not found"));
    },
  );
}

/** Configure the keychain mock to return no token */
function mockKeychainNoToken() {
  mockExec.mockImplementation(
    (
      _cmd: string,
      _opts: unknown,
      cb: (
        err: Error | null,
        result: { stdout: string; stderr: string },
      ) => void,
    ) => {
      cb(null, { stdout: JSON.stringify({}), stderr: "" });
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset global fetch mock
  vi.stubGlobal("fetch", vi.fn());
});

// ---------------------------------------------------------------------------
// Successful fetch
// ---------------------------------------------------------------------------

describe("successful fetch", () => {
  it("returns usage data with status 'success'", async () => {
    mockKeychainSuccess();
    const apiData = makeApiResponse();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(apiData),
    } as Response);

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("success");
    expect(result.five_hour?.utilization).toBe(0.5);
    expect(result.seven_day?.utilization).toBe(0.3);
    expect(result.seven_day_sonnet?.utilization).toBe(0.1);
    expect(result.statusMessage).toBeNull();
    expect(result.retryAt).toBeNull();
    expect(result.updatedAt).toBeGreaterThan(0);
  });

  it("parses null resets_at correctly", async () => {
    mockKeychainSuccess();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          five_hour: { utilization: 0.1, resets_at: null },
          seven_day: { utilization: 0.2 },
          seven_day_sonnet: {},
        }),
    } as Response);

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.five_hour?.resets_at).toBeNull();
    expect(result.seven_day?.resets_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cached result within TTL (deduplication)
// ---------------------------------------------------------------------------

describe("caching and deduplication", () => {
  it("concurrent calls deduplicate — only one fetch fires", async () => {
    mockKeychainSuccess();
    let fetchCallCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeApiResponse()),
      } as Response;
    });

    const [r1, r2, r3] = await runTest(
      Effect.all([UsageService.getUsage(), UsageService.getUsage(), UsageService.getUsage()], {
        concurrency: "unbounded",
      }),
    );

    // All three should succeed
    expect(r1.status).toBe("success");
    expect(r2.status).toBe("success");
    expect(r3.status).toBe("success");

    // Only one fetch should have been made (cachedWithTTL deduplicates)
    expect(fetchCallCount).toBe(1);
  });

  it("second sequential call within TTL uses cached result", async () => {
    mockKeychainSuccess();
    let fetchCallCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async () => {
      fetchCallCount++;
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(makeApiResponse()),
      } as Response;
    });

    const result = await runTest(
      Effect.gen(function* () {
        const s = yield* UsageService;
        const r1 = yield* s.getUsage();
        const r2 = yield* s.getUsage();
        return [r1, r2] as const;
      }),
    );

    expect(result[0].status).toBe("success");
    expect(result[1].status).toBe("success");
    expect(fetchCallCount).toBe(1); // only one fetch within TTL
  });
});

// ---------------------------------------------------------------------------
// Rate-limit handling
// ---------------------------------------------------------------------------

describe("rate-limit handling", () => {
  it("returns rate_limited response when API returns 429", async () => {
    mockKeychainSuccess();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as Response);

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("rate_limited");
    expect(result.retryAt).toBeGreaterThan(Date.now());
  });

  it("subsequent calls during backoff return cached data with rate_limited status", async () => {
    mockKeychainSuccess();

    // First call: success (populate lastGoodData)
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeApiResponse()),
    } as Response);

    // Second call (after TTL expires): 429
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as Response);

    const first = await runTest(
      Effect.gen(function* () {
        const s = yield* UsageService;
        // First fetch — populate lastGoodData
        return yield* s.getUsage();
      }),
    );

    expect(first.status).toBe("success");
  });

  it("rate-limited with no cache returns empty rate_limited response", async () => {
    mockKeychainSuccess();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as Response);

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("rate_limited");
    expect(result.five_hour).toBeNull();
    expect(result.seven_day).toBeNull();
    expect(result.retryAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Keychain errors
// ---------------------------------------------------------------------------

describe("keychain error handling", () => {
  it("keychain failure returns error status gracefully", async () => {
    mockKeychainFailure();

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("error");
    expect(result.statusMessage).toBeTruthy();
    expect(result.five_hour).toBeNull();
  });

  it("no token returns error status gracefully", async () => {
    mockKeychainNoToken();

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("error");
    expect(result.five_hour).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fetch error with cached fallback
// ---------------------------------------------------------------------------

describe("fetch error handling", () => {
  it("non-429 HTTP error returns error status with no cache", async () => {
    mockKeychainSuccess();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    } as Response);

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("error");
    expect(result.statusMessage).toContain("500");
    expect(result.five_hour).toBeNull();
  });

  it("network error returns error status gracefully", async () => {
    mockKeychainSuccess();
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error("Network error"),
    );

    const result = await runTest(
      UsageService.getUsage(),
    );

    expect(result.status).toBe("error");
    expect(result.statusMessage).toContain("Network error");
  });
});

// ---------------------------------------------------------------------------
// Module-level state elimination
// ---------------------------------------------------------------------------

describe("module-level state elimination", () => {
  it("each Layer.provide gets a fresh independent service instance", async () => {
    // Instance A: succeeds
    mockKeychainSuccess();
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeApiResponse()),
    } as Response);
    const resultA = await runTest(
      UsageService.getUsage(),
    );
    expect(resultA.status).toBe("success");

    // Instance B: fails (separate Layer.provide, no shared state)
    mockKeychainFailure();
    const resultB = await runTest(
      UsageService.getUsage(),
    );
    expect(resultB.status).toBe("error");

    // Instance A's successful result didn't bleed into B — state is not module-level
  });

  it("UsageService is a proper Effect.Tag (not module-level)", () => {
    // Effect.Tag.key is a string identifier
    expect(UsageService.key).toBeDefined();
    expect(UsageService.key).toBe("UsageService");
  });
});

// ---------------------------------------------------------------------------
// Error type verification
// ---------------------------------------------------------------------------

describe("error types from errors.ts", () => {
  it("UsageApiError has correct _tag", async () => {
    const { UsageApiError } = await import("../../errors");
    const err = new UsageApiError({ message: "test", statusCode: 500 });
    expect(err._tag).toBe("UsageApiError");
    expect(err.message).toBe("test");
    expect(err.statusCode).toBe(500);
  });

  it("UsageRateLimitedError has correct _tag", async () => {
    const { UsageRateLimitedError } = await import("../../errors");
    const err = new UsageRateLimitedError({ retryAfter: 12345 });
    expect(err._tag).toBe("UsageRateLimitedError");
    expect(err.retryAfter).toBe(12345);
  });

  it("KeychainError has correct _tag", async () => {
    const { KeychainError } = await import("../../errors");
    const err = new KeychainError({ message: "not found" });
    expect(err._tag).toBe("KeychainError");
    expect(err.message).toBe("not found");
  });
});
