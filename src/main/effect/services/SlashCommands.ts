/**
 * SlashCommands Effect Service
 *
 * Replaces the module-level Map cache and Promise-based inflight deduplication
 * in slash-commands.ts with structured Effect concurrency primitives.
 *
 * - Effect.Ref<Map> replaces module-level `commandsCache` and `commandsFetching`
 * - Deferred replaces raw Promise deduplication — concurrent callers for the
 *   same cwd wait on the same Deferred instead of spawning duplicate fetches
 * - Effect.acquireRelease manages the temporary SDK query lifecycle, ensuring
 *   queryObj.close() is always called even on error
 */

import { Context, Effect, Layer, Ref, Deferred } from "effect";
import { SlashCommandError } from "../errors.js";
import { getSdkClient } from "../../agents/sdk-client.js";
import { discoverClaudeCli } from "../../agents/cli-discovery.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlashCommandInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

/** Minimal interface for any query object that supports supportedCommands() */
export interface ActiveQuery {
  supportedCommands(): Promise<unknown[]>;
}

interface CacheEntry {
  commands: SlashCommandInfo[];
  fetchedAt: number;
}

/** Custom app-level commands (not from the SDK) */
const CUSTOM_COMMANDS: SlashCommandInfo[] = [
  { name: "clear", description: "Clear conversation context and start fresh" },
];

const COMMANDS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SlashCommandsService {
  /**
   * Get supported slash commands for a project directory.
   *
   * Priority:
   * 1. If activeQuery is provided (active subprocess), query it directly
   *    and update the cache.
   * 2. Check the per-cwd cache (5-minute TTL).
   * 3. Deduplicate concurrent cache-miss fetches via Deferred — only one
   *    temporary subprocess is spawned per cwd at a time.
   * 4. Spawn a temporary SDK query via acquireRelease and call supportedCommands().
   *
   * CUSTOM_COMMANDS are always prepended to the result.
   * Errors during temporary query spawn fall back to [] (resilient behavior).
   */
  getCommands(
    cwd: string,
    activeQuery?: ActiveQuery,
  ): Effect.Effect<SlashCommandInfo[], SlashCommandError>;
}

/** Context tag for the SlashCommands service */
export class SlashCommands extends Context.Tag("SlashCommands")<
  SlashCommands,
  SlashCommandsService
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCommands(
  commands: Array<{ name: string; description: string; argumentHint?: string }>,
): SlashCommandInfo[] {
  return commands.map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    argumentHint: cmd.argumentHint,
  }));
}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const SlashCommandsLive = Layer.effect(
  SlashCommands,
  Effect.gen(function* () {
    const cacheRef = yield* Ref.make(new Map<string, CacheEntry>());
    const inflightRef = yield* Ref.make(
      new Map<string, Deferred.Deferred<SlashCommandInfo[]>>(),
    );

    /**
     * Spawn a short-lived SDK query to call supportedCommands(), then release it.
     * Uses Effect.acquireRelease to guarantee queryObj.close() is always called.
     */
    const fetchViaTemporaryQuery = (
      cwd: string,
    ): Effect.Effect<SlashCommandInfo[], SlashCommandError> =>
      Effect.scoped(
        Effect.gen(function* () {
          const sdk = yield* Effect.tryPromise({
            try: () => getSdkClient(),
            catch: (e) =>
              new SlashCommandError({
                message: "Failed to get SDK client",
                cause: e,
              }),
          });

          const cliInfo = yield* Effect.tryPromise({
            try: () => discoverClaudeCli(),
            catch: (e) =>
              new SlashCommandError({
                message: "Failed to discover Claude CLI",
                cause: e,
              }),
          });

          // CLI not found — graceful fallback
          if (!cliInfo) {
            return [] as SlashCommandInfo[];
          }

          // Async iterable that never yields — keeps the subprocess alive
          // long enough to call supportedCommands(), then close() releases it
          const neverYield: AsyncIterable<unknown> = {
            [Symbol.asyncIterator]() {
              return {
                next: () => new Promise<IteratorResult<unknown>>(() => {}),
              };
            },
          };

          const queryObj = yield* Effect.acquireRelease(
            Effect.sync(() =>
              sdk.query({
                prompt: neverYield,
                options: {
                  cwd,
                  permissionMode: "acceptEdits",
                  pathToClaudeCodeExecutable: cliInfo.path,
                },
              }),
            ),
            (q) =>
              Effect.sync(() => {
                try {
                  q.close();
                } catch {
                  // Already closed — ignore
                }
              }),
          );

          return yield* Effect.tryPromise({
            try: () =>
              queryObj.supportedCommands() as Promise<
                Array<{
                  name: string;
                  description: string;
                  argumentHint?: string;
                }>
              >,
            catch: (e) =>
              new SlashCommandError({
                message: "supportedCommands() failed on temporary query",
                cause: e,
              }),
          }).pipe(Effect.map(mapCommands));
        }),
      );

    return {
      getCommands: (cwd, activeQuery) =>
        Effect.gen(function* () {
          // 1. Try active subprocess query directly
          if (activeQuery) {
            const result = yield* Effect.tryPromise({
              try: () =>
                activeQuery.supportedCommands() as Promise<
                  Array<{
                    name: string;
                    description: string;
                    argumentHint?: string;
                  }>
                >,
              catch: (e) =>
                new SlashCommandError({
                  message: "Active query supportedCommands() failed",
                  cause: e,
                }),
            }).pipe(
              Effect.map(mapCommands),
              Effect.tap((commands) =>
                Ref.update(cacheRef, (m) => {
                  const next = new Map(m);
                  next.set(cwd, { commands, fetchedAt: Date.now() });
                  return next;
                }),
              ),
              // Active query errors fall back to [] (matches original behavior)
              Effect.catchAll(() => Effect.succeed([] as SlashCommandInfo[])),
            );
            return [...CUSTOM_COMMANDS, ...result];
          }

          // 2. Check per-cwd cache (5-minute TTL)
          const cacheMap = yield* Ref.get(cacheRef);
          const cached = cacheMap.get(cwd);
          if (cached && Date.now() - cached.fetchedAt < COMMANDS_CACHE_TTL) {
            return [...CUSTOM_COMMANDS, ...cached.commands];
          }

          // 3. Deduplicate in-flight fetches — use Ref.modify for atomic check-and-set
          const newDeferred = yield* Deferred.make<SlashCommandInfo[]>();
          const [isOwner, activeDeferred] = yield* Ref.modify(
            inflightRef,
            (m) => {
              if (m.has(cwd)) {
                // Another fiber is already fetching — join it
                return [[false, m.get(cwd)!] as const, m];
              }
              // We are the first — register our Deferred and become the owner
              const next = new Map(m);
              next.set(cwd, newDeferred);
              return [[true, newDeferred] as const, next];
            },
          );

          if (!isOwner) {
            // Wait for the owning fiber to complete and return its result
            const result = yield* Deferred.await(activeDeferred);
            return [...CUSTOM_COMMANDS, ...result];
          }

          // 4. We are the owner — spawn a temporary query
          const sdkCommands = yield* fetchViaTemporaryQuery(cwd).pipe(
            // Temporary query errors fall back to [] (resilient)
            Effect.catchAll(() => Effect.succeed([] as SlashCommandInfo[])),
          );

          // Update cache and unblock waiting fibers
          yield* Ref.update(cacheRef, (m) => {
            const next = new Map(m);
            next.set(cwd, { commands: sdkCommands, fetchedAt: Date.now() });
            return next;
          });
          yield* Deferred.succeed(newDeferred, sdkCommands);
          yield* Ref.update(inflightRef, (m) => {
            const next = new Map(m);
            next.delete(cwd);
            return next;
          });

          return [...CUSTOM_COMMANDS, ...sdkCommands];
        }),
    };
  }),
);
