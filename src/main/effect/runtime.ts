import { Effect, ManagedRuntime } from "effect";
import { DatabaseLive } from "./services/Database.js";

export const AppLayer = DatabaseLive;

export const AppRuntime = ManagedRuntime.make(AppLayer);

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  return AppRuntime.runPromise(effect);
}
