/**
 * The server-stamped start of a session's running turn, on this device's clock.
 *
 * `session-status-store` owns the value (it arrives with every non-idle
 * status) and registers the lookup here, so `updateSession` can anchor every
 * session's timer to it without importing that store, which imports it.
 */
type TurnStartResolver = (sessionDbId: number) => number | null;

let resolveTurnStart: TurnStartResolver = () => null;

export function registerTurnStartResolver(resolver: TurnStartResolver): void {
  resolveTurnStart = resolver;
}

export function serverTurnStartLocalMs(sessionDbId: number | null): number | null {
  return sessionDbId == null ? null : resolveTurnStart(sessionDbId);
}
