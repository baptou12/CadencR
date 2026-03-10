/**
 * UsageService Effect Service
 *
 * Replaces module-level mutable state in usage-service.ts with structured
 * Effect concurrency primitives.
 *
 * - Effect.cachedWithTTL replaces `let cachedResult` + `let lastFetchTime` + `let inflight`
 *   (5-minute TTL, automatic deduplication of concurrent callers)
 * - Effect.Ref<Option<number>> replaces `let rateLimitedUntil`
 * - Effect.Ref<Option<UsageResponse>> tracks the last-known-good response for fallbacks
 * - Keychain exec wrapped in Effect.tryPromise with KeychainError (kept inline per plan)
 * - HTTP fetch wrapped in Effect.tryPromise with UsageApiError
 */

import { Context, Effect, Layer, Ref, Option, Duration } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  UsageApiError,
  UsageRateLimitedError,
  KeychainError,
} from "../errors.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Re-export types used by callers
// ---------------------------------------------------------------------------

export interface UsageBucket {
  utilization: number;
  resets_at: string | null;
}

export type UsageStatus = "success" | "cached" | "rate_limited" | "error";

export interface UsageResponse {
  five_hour: UsageBucket | null;
  seven_day: UsageBucket | null;
  seven_day_sonnet: UsageBucket | null;
  status: UsageStatus;
  statusMessage: string | null;
  retryAt: number | null; // epoch ms when rate-limit backoff expires
  updatedAt: number; // epoch ms of last successful fetch
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface UsageServiceI {
  /**
   * Get current usage data. Always returns a UsageResponse — errors are
   * converted to fallback responses. The underlying fetch is cached for
   * 5 minutes with automatic deduplication of concurrent callers.
   */
  getUsage(): Effect.Effect<UsageResponse, never>;
}

/** Context tag for the UsageService */
export class UsageService extends Context.Tag("UsageService")<
  UsageService,
  UsageServiceI
>() {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL = Duration.minutes(5);
const MIN_RATE_LIMIT_MS = 20 * 60 * 1000; // 20-minute floor for 429 backoff

const EMPTY_BUCKETS = {
  five_hour: null,
  seven_day: null,
  seven_day_sonnet: null,
} as const;

type RawBucket = { utilization?: unknown; resets_at?: unknown };
type RawUsage = {
  five_hour?: RawBucket;
  seven_day?: RawBucket;
  seven_day_sonnet?: RawBucket;
};

function parseBucket(b: RawBucket | undefined): UsageBucket {
  return {
    utilization: Number(b?.utilization) || 0,
    resets_at: typeof b?.resets_at === "string" ? b.resets_at : null,
  };
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const UsageServiceLive = Layer.effect(
  UsageService,
  Effect.gen(function* () {
    // Tracks the epoch ms when rate-limit backoff expires (none = not rate-limited)
    const rateLimitedUntil = yield* Ref.make(Option.none<number>());

    // Tracks the last successfully fetched response for use as fallback
    const lastGoodData = yield* Ref.make(Option.none<UsageResponse>());

    // ------------------------------------------------------------------
    // Keychain: get OAuth token (inline, per plan clarification)
    // ------------------------------------------------------------------

    const getOAuthToken: Effect.Effect<string | null, KeychainError> =
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            execAsync(
              'security find-generic-password -s "Claude Code-credentials" -w',
              { encoding: "utf-8" },
            ),
          catch: (e) =>
            new KeychainError({ message: "Keychain access failed", cause: e }),
        });
        try {
          const parsed = JSON.parse(result.stdout.trim());
          const token = parsed?.claudeAiOauth?.accessToken;
          return typeof token === "string" ? token : null;
        } catch {
          return null;
        }
      });

    // ------------------------------------------------------------------
    // Raw fetch effect — may fail with UsageApiError | UsageRateLimitedError | KeychainError
    // ------------------------------------------------------------------

    const fetchUsageEffect: Effect.Effect<
      UsageResponse,
      UsageApiError | UsageRateLimitedError | KeychainError
    > = Effect.gen(function* () {
      const token = yield* getOAuthToken;
      if (!token) {
        return yield* Effect.fail(
          new KeychainError({ message: "No OAuth token found" }),
        );
      }

      const res = yield* Effect.tryPromise({
        try: () =>
          fetch("https://api.anthropic.com/api/oauth/usage", {
            headers: {
              Authorization: `Bearer ${token}`,
              "anthropic-beta": "oauth-2025-04-20",
            },
          }),
        catch: (e) =>
          new UsageApiError({
            message: e instanceof Error ? e.message : "Fetch failed",
            cause: e,
          }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = Date.now() + MIN_RATE_LIMIT_MS;
          yield* Ref.set(rateLimitedUntil, Option.some(retryAfter));
          return yield* Effect.fail(
            new UsageRateLimitedError({ retryAfter }),
          );
        }
        return yield* Effect.fail(
          new UsageApiError({
            message: `${res.status} ${res.statusText}`,
            statusCode: res.status,
          }),
        );
      }

      const raw = (yield* Effect.tryPromise({
        try: () => res.json() as Promise<RawUsage>,
        catch: (e) =>
          new UsageApiError({ message: "JSON parse failed", cause: e }),
      })) as RawUsage;

      const now = Date.now();
      const data: UsageResponse = {
        five_hour: parseBucket(raw?.five_hour),
        seven_day: parseBucket(raw?.seven_day),
        seven_day_sonnet: parseBucket(raw?.seven_day_sonnet),
        status: "success",
        statusMessage: null,
        retryAt: null,
        updatedAt: now,
      };

      // Persist as last-known-good response and clear any lingering rate-limit
      yield* Ref.set(lastGoodData, Option.some(data));
      yield* Ref.set(rateLimitedUntil, Option.none());

      return data;
    });

    // ------------------------------------------------------------------
    // fetchWithFallback — always succeeds by catching all errors and
    // returning an appropriate UsageResponse (with cached data when available)
    // ------------------------------------------------------------------

    const fetchWithFallback: Effect.Effect<UsageResponse> =
      fetchUsageEffect.pipe(
        Effect.catchAll((e) =>
          Effect.gen(function* () {
            const cached = yield* Ref.get(lastGoodData);
            const rl = yield* Ref.get(rateLimitedUntil);

            // Rate-limited path
            if (e._tag === "UsageRateLimitedError") {
              const retryAt = Option.isSome(rl) ? rl.value : null;
              if (Option.isSome(cached)) {
                return {
                  ...cached.value,
                  status: "rate_limited" as const,
                  statusMessage: null,
                  retryAt,
                  updatedAt: cached.value.updatedAt,
                };
              }
              return {
                ...EMPTY_BUCKETS,
                status: "rate_limited" as const,
                statusMessage: null,
                retryAt,
                updatedAt: Date.now(),
              };
            }

            // Generic error path — fall back to cached data if available
            // At this point e is UsageApiError | KeychainError (rate-limited was handled above)
            const msg = "message" in e ? (e.message as string) : "Unknown error";

            if (Option.isSome(cached)) {
              return {
                ...cached.value,
                status: "error" as const,
                statusMessage: msg,
                retryAt: null,
                updatedAt: cached.value.updatedAt,
              };
            }
            return {
              ...EMPTY_BUCKETS,
              status: "error" as const,
              statusMessage: msg,
              retryAt: null,
              updatedAt: Date.now(),
            };
          }),
        ),
      );

    // ------------------------------------------------------------------
    // Cached effect — 5-minute TTL with automatic concurrent deduplication
    // ------------------------------------------------------------------

    const cachedFetch = yield* Effect.cachedWithTTL(
      fetchWithFallback,
      CACHE_TTL,
    );

    // ------------------------------------------------------------------
    // Service implementation
    // ------------------------------------------------------------------

    return {
      getUsage: () =>
        Effect.gen(function* () {
          // Short-circuit on active rate-limit (before calling cachedFetch)
          const rl = yield* Ref.get(rateLimitedUntil);
          if (Option.isSome(rl) && Date.now() < rl.value) {
            const cached = yield* Ref.get(lastGoodData);
            const retryAt = rl.value;
            if (Option.isSome(cached)) {
              return {
                ...cached.value,
                status: "rate_limited" as const,
                statusMessage: null,
                retryAt,
                updatedAt: cached.value.updatedAt,
              };
            }
            return {
              ...EMPTY_BUCKETS,
              status: "rate_limited" as const,
              statusMessage: null,
              retryAt,
              updatedAt: Date.now(),
            };
          }

          return yield* cachedFetch;
        }),
    };
  }),
);
