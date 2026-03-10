/**
 * ToolPermissions Effect Service
 *
 * Replaces the global EventEmitter pattern in tool-permissions.ts with
 * structured Effect concurrency primitives (Deferred).
 *
 * Owns: canUseTool SDK callback flow — tool permission requests and
 * AskUserQuestion responses. Each pending request is represented by a Deferred
 * stored in an internal Map keyed by subprocessId, with 15-minute timeouts.
 *
 * Plan/PRD approval (show_plan / show_prd MCP flow) is owned by PlanApproval.
 */

import { Effect, Layer, Deferred, Duration } from "effect";
import {
  PermissionTimeoutError,
  QuestionTimeoutError,
} from "../errors.js";
import {
  broadcast,
  ASK_USER_QUESTION_CHANNEL,
  TOOL_PERMISSION_CHANNEL,
} from "../../agents/broadcast.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionDecision = "allow_once" | "allow_future" | "deny";

export interface PermissionResult {
  decision: PermissionDecision;
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface ToolPermissionsService {
  /**
   * Request permission from the user for a tool call.
   * Creates a Deferred, broadcasts the request to renderer windows, and awaits
   * user response with a 15-minute timeout.
   */
  requestPermission(
    subprocessId: string,
    permissionRequest: {
      toolName: string;
      input: Record<string, unknown>;
      description: string;
      pattern: string;
    },
  ): Effect.Effect<PermissionResult, PermissionTimeoutError>;

  /**
   * Resolve a pending permission request. No-op if no Deferred is pending
   * (e.g. already timed out).
   */
  submitPermission(
    subprocessId: string,
    decision: PermissionDecision,
    feedback?: string,
  ): Effect.Effect<void>;

  /**
   * Request user answers to AskUserQuestion.
   * Creates a Deferred, broadcasts the question to renderer windows, and awaits
   * user answers with a 15-minute timeout.
   */
  requestUserAnswer(
    subprocessId: string,
    questions: Record<string, unknown>,
  ): Effect.Effect<Record<string, string>, QuestionTimeoutError>;

  /**
   * Resolve a pending user-answer request. No-op if no Deferred is pending.
   */
  submitUserAnswer(
    subprocessId: string,
    answers: Record<string, string>,
  ): Effect.Effect<void>;
}

/** Context tag for the ToolPermissions service */
export class ToolPermissions extends Effect.Tag("ToolPermissions")<
  ToolPermissions,
  ToolPermissionsService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const ToolPermissionsLive = Layer.sync(ToolPermissions, () => {
  // Internal Deferred maps — one entry per pending request, keyed by subprocessId
  const permissionDeferreds = new Map<string, Deferred.Deferred<PermissionResult>>();
  const answerDeferreds = new Map<string, Deferred.Deferred<Record<string, string>>>();

  return {
    // -------------------------------------------------------------------------
    // Permission requests
    // -------------------------------------------------------------------------

    requestPermission: (subprocessId, permissionRequest) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<PermissionResult>();
        permissionDeferreds.set(subprocessId, deferred);

        // Broadcast request to renderer windows
        broadcast(TOOL_PERMISSION_CHANNEL, { subprocessId, ...permissionRequest });

        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: Duration.minutes(15),
            onTimeout: () => new PermissionTimeoutError({ subprocessId }),
          }),
          Effect.ensuring(Effect.sync(() => permissionDeferreds.delete(subprocessId))),
        );
      }),

    submitPermission: (subprocessId, decision, feedback) =>
      Effect.gen(function* () {
        const deferred = permissionDeferreds.get(subprocessId);
        if (deferred) {
          const resolved = yield* Deferred.succeed(deferred, { decision, feedback });
          if (!resolved) {
            yield* Effect.logWarning("Permission submission arrived after timeout", { subprocessId });
          }
        }
      }),

    // -------------------------------------------------------------------------
    // User-answer requests (AskUserQuestion)
    // -------------------------------------------------------------------------

    requestUserAnswer: (subprocessId, questions) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<Record<string, string>>();
        answerDeferreds.set(subprocessId, deferred);

        // Broadcast question to renderer windows
        broadcast(ASK_USER_QUESTION_CHANNEL, { subprocessId, questions });

        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: Duration.minutes(15),
            onTimeout: () => new QuestionTimeoutError({ subprocessId }),
          }),
          Effect.ensuring(Effect.sync(() => answerDeferreds.delete(subprocessId))),
        );
      }),

    submitUserAnswer: (subprocessId, answers) =>
      Effect.gen(function* () {
        const deferred = answerDeferreds.get(subprocessId);
        if (deferred) {
          const resolved = yield* Deferred.succeed(deferred, answers);
          if (!resolved) {
            yield* Effect.logWarning("User answer submission arrived after timeout", { subprocessId });
          }
        }
      }),
  };
});
