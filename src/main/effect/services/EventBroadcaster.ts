/**
 * EventBroadcaster Effect Service
 *
 * Effect-typed service that handles all IPC event broadcasting to renderer windows:
 * - Agent stream events (AGENT_EVENT_CHANNEL)
 * - DB update notifications (DB_UPDATED_CHANNEL)
 * - Throttled notifications (batches rapid stream events into one notify per 200ms)
 */

import { Effect, Layer } from "effect";
import { BrowserWindow } from "electron";
import type { AgentType, StreamEvent, AgentEvent } from "../../agents/types.js";
import { SessionPersistence } from "./SessionPersistence.js";

// ---------------------------------------------------------------------------
// Channel constants (re-exported so callers don't need to import from broadcast.ts)
// ---------------------------------------------------------------------------

export const AGENT_EVENT_CHANNEL = "agent:event";
export const DB_UPDATED_CHANNEL = "db:updated";

/** Send a message to all non-destroyed renderer windows. */
function sendToAll(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface EventBroadcasterService {
  /**
   * Broadcast a stream event to all renderer windows on the agent:event channel.
   * Constructs a full AgentEvent envelope from the individual fields.
   */
  broadcastAgentEvent: (
    id: string,
    agentType: AgentType,
    event: StreamEvent,
    parentToolUseId?: string | null,
    messageDbId?: number | null,
  ) => Effect.Effect<void>;

  /** Notify all renderer windows that data changed in the DB. */
  notifyDbUpdated: (entity: string, featureId: number) => Effect.Effect<void>;

  /**
   * Throttled DB notification — batches rapid stream events for a given
   * sessionKey into a single notifyDbUpdated call every 200ms.
   */
  throttledNotify: (
    sessionKey: string,
    featureId: number,
  ) => Effect.Effect<void>;

  /**
   * Flush any pending throttled notification for a sessionKey immediately.
   * Call this when a session ends so the final state is broadcast promptly.
   */
  flushNotify: (sessionKey: string) => Effect.Effect<void>;
}

/** Context tag for the EventBroadcaster service */
export class EventBroadcaster extends Effect.Tag("EventBroadcaster")<
  EventBroadcaster,
  EventBroadcasterService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const EventBroadcasterLive = Layer.scoped(
  EventBroadcaster,
  Effect.gen(function* () {
    const sp = yield* SessionPersistence;

    // ---------------------------------------------------------------------------
    // Internal state — throttle timers
    // ---------------------------------------------------------------------------
    const pendingNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const pendingNotifyFeatureIds = new Map<string, number>();

    // Finalizer: clear all pending throttle timers on runtime disposal
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const timer of pendingNotifyTimers.values()) {
          clearTimeout(timer);
        }
        pendingNotifyTimers.clear();
        pendingNotifyFeatureIds.clear();
      }),
    );

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    function doNotifyDbUpdated(entity: string, featureId: number): void {
      sendToAll(DB_UPDATED_CHANNEL, { entity, featureId });
    }

    // ---------------------------------------------------------------------------
    // Service implementation
    // ---------------------------------------------------------------------------

    return {
      broadcastAgentEvent: (
        id: string,
        agentType: AgentType,
        event: StreamEvent,
        parentToolUseId?: string | null,
        messageDbId?: number | null,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          const sessionDbId = yield* sp.getSessionDbId(id);
          const agentEvent: AgentEvent = {
            subprocessId: id,
            agentType,
            event,
            timestamp: Date.now(),
            parentToolUseId: parentToolUseId ?? undefined,
            sessionDbId: sessionDbId ?? undefined,
            messageDbId: messageDbId ?? undefined,
          };
          sendToAll(AGENT_EVENT_CHANNEL, agentEvent);
        }),

      notifyDbUpdated: (
        entity: string,
        featureId: number,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          doNotifyDbUpdated(entity, featureId);
        }),

      throttledNotify: (
        sessionKey: string,
        featureId: number,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          pendingNotifyFeatureIds.set(sessionKey, featureId);
          if (pendingNotifyTimers.has(sessionKey)) return; // already scheduled
          pendingNotifyTimers.set(
            sessionKey,
            setTimeout(() => {
              pendingNotifyTimers.delete(sessionKey);
              const fid = pendingNotifyFeatureIds.get(sessionKey);
              pendingNotifyFeatureIds.delete(sessionKey);
              if (fid != null) doNotifyDbUpdated("agent_session", fid);
            }, 200),
          );
        }),

      flushNotify: (sessionKey: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const timer = pendingNotifyTimers.get(sessionKey);
          if (timer) {
            clearTimeout(timer);
            pendingNotifyTimers.delete(sessionKey);
          }
          const fid = pendingNotifyFeatureIds.get(sessionKey);
          pendingNotifyFeatureIds.delete(sessionKey);
          if (fid != null) doNotifyDbUpdated("agent_session", fid);
        }),
    };
  }),
);
