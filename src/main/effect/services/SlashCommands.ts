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

import { Effect, Layer, Option, Ref, Deferred } from "effect";
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

type RawCommand = { name: string; description: string; argumentHint?: string };

/** Result of the atomic inflight check-and-register operation */
type InflightResult =
  | { readonly isOwner: true; readonly deferred: Deferred.Deferred<SlashCommandInfo[], SlashCommandError> }
  | { readonly isOwner: false; readonly deferred: Deferred.Deferred<SlashCommandInfo[], SlashCommandError> };

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
export class SlashCommands extends Effect.Tag("SlashCommands")<
  SlashCommands,
  SlashCommandsService
>() {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCommands(commands: Array<RawCommand>): SlashCommandInfo[] {
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
      new Map<string, Deferred.Deferred<SlashCommandInfo[], SlashCommandError>>(),
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

          // CLI not found — graceful fallback
          const cliInfoOpt = yield* discoverClaudeCli().pipe(Effect.option);
          if (Option.isNone(cliInfoOpt)) {
            return [] as SlashCommandInfo[];
          }
          const cliInfo = cliInfoOpt.value;

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

          const raw = yield* Effect.tryPromise({
            try: () => queryObj.supportedCommands() as Promise<RawCommand[]>,
            catch: (e) =>
              new SlashCommandError({
                message: "supportedCommands() failed on temporary query",
                cause: e,
              }),
          });
          return mapCommands(raw);
        }),
      );

    const service: SlashCommandsService = {
      getCommands: (cwd, activeQuery) =>
        Effect.gen(function* () {
          // 1. Try active subprocess query directly
          if (activeQuery) {
            const sdkCmds: SlashCommandInfo[] = yield* Effect.tryPromise({
              try: () => activeQuery.supportedCommands() as Promise<RawCommand[]>,
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
              Effect.catchAll(() =>
                Effect.succeed([] as SlashCommandInfo[]),
              ),
            );
            return [...CUSTOM_COMMANDS, ...sdkCmds];
          }

          // 2. Check per-cwd cache (5-minute TTL)
          const cacheMap = yield* Ref.get(cacheRef);
          const cached = cacheMap.get(cwd);
          if (cached && Date.now() - cached.fetchedAt < COMMANDS_CACHE_TTL) {
            return [...CUSTOM_COMMANDS, ...cached.commands];
          }

          // 3. Deduplicate in-flight fetches — use Ref.modify for atomic check-and-set
          const newDeferred = yield* Deferred.make<SlashCommandInfo[], SlashCommandError>();

          const inflightResult: InflightResult = yield* Ref.modify(
            inflightRef,
            (
              m,
            ): readonly [
              InflightResult,
              Map<string, Deferred.Deferred<SlashCommandInfo[], SlashCommandError>>,
            ] => {
              if (m.has(cwd)) {
                return [
                  { isOwner: false as const, deferred: m.get(cwd)! },
                  m,
                ];
              }
              const next = new Map(m);
              next.set(cwd, newDeferred);
              return [{ isOwner: true as const, deferred: newDeferred }, next];
            },
          );

          if (!inflightResult.isOwner) {
            // Wait for the owning fiber to complete and return its result.
            // If the owner is interrupted, the Deferred will fail with
            // SlashCommandError — catch it and fall back to [] rather than
            // propagating the error.
            const result: SlashCommandInfo[] = yield* Deferred.await(
              inflightResult.deferred,
            ).pipe(Effect.catchAll(() => Effect.succeed([] as SlashCommandInfo[])));
            return [...CUSTOM_COMMANDS, ...result];
          }

          // 4. We are the owner — spawn a temporary query, then unblock waiting
          // fibers. Two finalizers protect against premature interruption:
          //
          // - Effect.onInterrupt: when this fiber is interrupted (e.g. during app
          //   shutdown) before Deferred.succeed fires, fail the Deferred so that
          //   any waiting fibers get a clean SlashCommandError instead of hanging
          //   indefinitely.
          //
          // - Effect.ensuring: always remove the inflight entry from the map,
          //   regardless of success, error, or interruption, so subsequent
          //   requests for the same cwd start a fresh fetch rather than waiting
          //   on a completed (or dead) Deferred.
          const fetchAndResolve: Effect.Effect<SlashCommandInfo[], SlashCommandError> =
            Effect.gen(function* () {
              const sdkCommands = yield* fetchViaTemporaryQuery(cwd).pipe(
                // Temporary query errors fall back to [] (resilient)
                Effect.catchAll(() => Effect.succeed([] as SlashCommandInfo[])),
              );
              // Update cache
              yield* Ref.update(cacheRef, (m) => {
                const next = new Map(m);
                next.set(cwd, { commands: sdkCommands, fetchedAt: Date.now() });
                return next;
              });
              // Unblock waiting fibers
              yield* Deferred.succeed(inflightResult.deferred, sdkCommands);
              return sdkCommands;
            }).pipe(
              // On interruption, fail the Deferred so waiting fibers unblock with
              // a SlashCommandError (which they catch and convert to []).
              Effect.onInterrupt(() =>
                Deferred.fail(
                  inflightResult.deferred,
                  new SlashCommandError({ message: "Slash commands fetch was interrupted" }),
                ),
              ),
            );

          const sdkCommands: SlashCommandInfo[] = yield* Effect.ensuring(
            fetchAndResolve,
            // Always clean up the inflight entry — runs on success, error, and interruption
            Ref.update(inflightRef, (m) => {
              const next = new Map(m);
              next.delete(cwd);
              return next;
            }),
          );

          return [...CUSTOM_COMMANDS, ...sdkCommands];
        }) as Effect.Effect<SlashCommandInfo[], SlashCommandError>,
    };

    return service;
  }),
);
