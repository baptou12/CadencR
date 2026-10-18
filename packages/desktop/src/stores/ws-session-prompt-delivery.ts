/**
 * Delivery promises for prompts queued before `session.initialized`.
 *
 * `sendPrompt` on a session without a `serverSessionId` only parks the prompt
 * in `queuedPrompts`; it reaches the wire once initialization flushes the
 * queue. A composer that awaits {@link awaitQueuedPromptDelivery} keeps its
 * pending state until then, and gets the prompt back when initialization
 * fails or the session is torn down first (issue #251). Promise callbacks are
 * not render state, so they live here rather than in the zustand entry.
 */

interface DeliveryWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

const waitersBySession = new Map<string, Map<string, DeliveryWaiter>>();

export const SESSION_CLOSED_BEFORE_DELIVERY = "The session closed before the message was sent.";

export function awaitQueuedPromptDelivery(sessionId: string, messageUuid: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiters = waitersBySession.get(sessionId) ?? new Map<string, DeliveryWaiter>();
    waiters.set(messageUuid, { resolve, reject });
    waitersBySession.set(sessionId, waiters);
  });
}

/** Resolve the waiters of prompts that just left the init queue. */
export function settleQueuedPromptDelivery(
  sessionId: string,
  prompts: ReadonlyArray<{ messageUuid: string }>,
): void {
  const waiters = waitersBySession.get(sessionId);
  if (!waiters) return;
  for (const { messageUuid } of prompts) {
    waiters.get(messageUuid)?.resolve();
    waiters.delete(messageUuid);
  }
  if (waiters.size === 0) waitersBySession.delete(sessionId);
}

/** Reject every waiter of a session whose queued prompts will never be sent. */
export function failQueuedPromptDelivery(sessionId: string, message: string): void {
  const waiters = waitersBySession.get(sessionId);
  if (!waiters) return;
  waitersBySession.delete(sessionId);
  for (const waiter of waiters.values()) waiter.reject(new Error(message));
}
