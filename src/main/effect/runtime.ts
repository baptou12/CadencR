import { Effect, Layer, ManagedRuntime } from "effect";

export const AppLayer = Layer.empty;

export const AppRuntime = ManagedRuntime.make(AppLayer);

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> {
  return AppRuntime.runPromise(effect);
}
