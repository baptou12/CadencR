/**
 * Delivery promises for prompts that could not leave immediately: queued
 * before `session.initialized` (keyed by `messageUuid`), or parked in the
 * outbound queue while the socket is down (keyed by envelope id).
 *
 * A composer that awaits {@link awaitPromptDelivery} keeps its pending state
 * until the prompt is on the wire, and gets it back when initialization fails
 * or the session is torn down first (issue #251). Promise callbacks are not
 * render state, so they live here rather than in the zustand entry.
 */

interface DeliveryWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

const waitersBySession = new Map<string, Map<string, DeliveryWaiter>>();

export const SESSION_CLOSED_BEFORE_DELIVERY = "The session closed before the message was sent.";

export function awaitPromptDelivery(sessionId: string, key: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiters = waitersBySession.get(sessionId) ?? new Map<string, DeliveryWaiter>();
    waiters.set(key, { resolve, reject });
    waitersBySession.set(sessionId, waiters);
  });
}

/** Resolve the waiters of prompts that just reached the wire. */
export function settlePromptDelivery(sessionId: string, keys: readonly string[]): void {
  const waiters = waitersBySession.get(sessionId);
  if (!waiters) return;
  for (const key of keys) {
    waiters.get(key)?.resolve();
    waiters.delete(key);
  }
  if (waiters.size === 0) waitersBySession.delete(sessionId);
}

/** Reject every waiter of a session whose held prompts will never be sent. */
export function failPromptDelivery(sessionId: string, message: string): void {
  const waiters = waitersBySession.get(sessionId);
  if (!waiters) return;
  waitersBySession.delete(sessionId);
  for (const waiter of waiters.values()) waiter.reject(new Error(message));
}
