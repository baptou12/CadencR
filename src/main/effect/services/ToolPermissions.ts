/**
 * ToolPermissions Effect Service
 *
 * Replaces the global EventEmitter pattern in tool-permissions.ts with
 * structured Effect concurrency primitives (Deferred).
 *
 * Each pending request (permission, user-answer, plan-approval, prd-approval)
 * is represented by a Deferred stored in an internal Map keyed by subprocessId.
 * Requests time out with Effect.timeoutFail instead of manual setTimeout/clearTimeout.
 *
 * DB persistence for pending states and broadcasting to renderer windows are
 * handled by callers (tool-permissions.ts, plan-approval.ts) — this service
 * is responsible only for the coordination primitives.
 */

import { Context, Effect, Layer, Deferred, Duration } from "effect";
import {
  PermissionTimeoutError,
  QuestionTimeoutError,
  ApprovalTimeoutError,
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

export interface ApprovalResult {
  approved: boolean;
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

  /**
   * Request plan approval (ExitPlanMode / show_plan).
   * Creates a Deferred and awaits user response with a 5-hour timeout.
   * Callers are responsible for DB state (pending_plan_approval) and broadcasting.
   */
  requestPlanApproval(
    subprocessId: string,
  ): Effect.Effect<ApprovalResult, ApprovalTimeoutError>;

  /**
   * Resolve a pending plan-approval request.
   * Returns true if a Deferred was found and resolved, false if not (e.g. agent
   * is paused/dead — caller should store the result in DB for resume).
   */
  submitPlanApproval(
    subprocessId: string,
    approved: boolean,
    feedback?: string,
  ): Effect.Effect<boolean>;

  /**
   * Request PRD approval (show_prd).
   * Creates a Deferred and awaits user response with a 5-hour timeout.
   */
  requestPrdApproval(
    subprocessId: string,
  ): Effect.Effect<ApprovalResult, ApprovalTimeoutError>;

  /**
   * Resolve a pending PRD-approval request.
   * Returns true if a Deferred was found and resolved, false if not.
   */
  submitPrdApproval(
    subprocessId: string,
    approved: boolean,
    feedback?: string,
  ): Effect.Effect<boolean>;
}

/** Context tag for the ToolPermissions service */
export class ToolPermissions extends Context.Tag("ToolPermissions")<
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
  const planApprovalDeferreds = new Map<string, Deferred.Deferred<ApprovalResult>>();
  const prdApprovalDeferreds = new Map<string, Deferred.Deferred<ApprovalResult>>();

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
          yield* Deferred.succeed(deferred, { decision, feedback });
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
          yield* Deferred.succeed(deferred, answers);
        }
      }),

    // -------------------------------------------------------------------------
    // Plan approval requests (ExitPlanMode / MCP show_plan)
    // -------------------------------------------------------------------------

    requestPlanApproval: (subprocessId) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<ApprovalResult>();
        planApprovalDeferreds.set(subprocessId, deferred);

        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: Duration.hours(5),
            onTimeout: () => new ApprovalTimeoutError({ subprocessId }),
          }),
          Effect.ensuring(Effect.sync(() => planApprovalDeferreds.delete(subprocessId))),
        );
      }),

    submitPlanApproval: (subprocessId, approved, feedback) =>
      Effect.gen(function* () {
        const deferred = planApprovalDeferreds.get(subprocessId);
        if (deferred) {
          yield* Deferred.succeed(deferred, { approved, feedback });
          return true;
        }
        return false;
      }),

    // -------------------------------------------------------------------------
    // PRD approval requests (MCP show_prd)
    // -------------------------------------------------------------------------

    requestPrdApproval: (subprocessId) =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<ApprovalResult>();
        prdApprovalDeferreds.set(subprocessId, deferred);

        return yield* Deferred.await(deferred).pipe(
          Effect.timeoutFail({
            duration: Duration.hours(5),
            onTimeout: () => new ApprovalTimeoutError({ subprocessId }),
          }),
          Effect.ensuring(Effect.sync(() => prdApprovalDeferreds.delete(subprocessId))),
        );
      }),

    submitPrdApproval: (subprocessId, approved, feedback) =>
      Effect.gen(function* () {
        const deferred = prdApprovalDeferreds.get(subprocessId);
        if (deferred) {
          yield* Deferred.succeed(deferred, { approved, feedback });
          return true;
        }
        return false;
      }),
  };
});
