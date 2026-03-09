/**
 * Singleton reference to the AppRuntime instance.
 *
 * This file exists to break the circular module-dependency chain that would
 * otherwise occur if effect-helpers.ts imported runtime.ts directly:
 *   effect-helpers → runtime → SdkQueryRunner → tool-permissions → effect-helpers
 *
 * The runtime is set once at startup from src/main.ts via `setAppRuntime()`,
 * and read by convenience wrappers in effect-helpers.ts via `getAppRuntime()`.
 */

import type { ManagedRuntime } from "effect";
import type { SessionPersistence } from "./services/SessionPersistence.js";
import type { EventBroadcaster } from "./services/EventBroadcaster.js";

/** Minimal requirement set used by the convenience wrappers in effect-helpers. */
type AppRequirements = SessionPersistence | EventBroadcaster;

type AppManagedRuntime = ManagedRuntime.ManagedRuntime<AppRequirements, never>;

let _runtime: AppManagedRuntime | undefined;

/**
 * Store the AppRuntime singleton. Must be called exactly once during app
 * startup (in src/main.ts) before any agent code runs.
 */
export function setAppRuntime(rt: AppManagedRuntime): void {
  _runtime = rt;
}

/**
 * Retrieve the AppRuntime singleton. Throws if called before `setAppRuntime()`.
 */
export function getAppRuntime(): AppManagedRuntime {
  if (!_runtime) {
    throw new Error(
      "AppRuntime has not been initialised yet — call setAppRuntime() during startup.",
    );
  }
  return _runtime;
}
