/**
 * PlanApproval Effect Service
 *
 * Replaces plan-approval.ts (EventEmitter/manual timeout pattern) with
 * structured Effect concurrency primitives (Deferred).
 *
 * Owns all plan and PRD approval coordination:
 * - DB state management (pending_plan_approval, plan_approval_result columns)
 * - Synthetic tool block insertion into agent_messages
 * - Deferred-based blocking wait with 5-hour timeout
 * - Resume path: reading stored approval results for paused agents
 * - Submit path: resolving Deferred or storing result for paused agents
 *
 * ToolPermissions owns: canUseTool, AskUserQuestion, ExitPlanMode SDK flow.
 * PlanApproval owns: MCP show_plan / show_prd blocking approval flow.
 *
 * Depends on: Database, SessionPersistence, EventBroadcaster
 */

import { Effect, Layer, Deferred, Duration } from "effect";
import { Database } from "./Database.js";
import { SessionPersistence } from "./SessionPersistence.js";
import { EventBroadcaster } from "./EventBroadcaster.js";
import { ApprovalTimeoutError, DatabaseError } from "../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalResult {
  approved: boolean;
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface PlanApprovalService {
  /**
   * Block until the user approves or rejects a plan.
   * Checks DB for stored result (paused agent resume path), emits synthetic
   * show_plan tool block, sets pending_plan_approval in DB, then awaits
   * user response with a 5-hour timeout. Cleans up DB on resolution.
   */
  waitForPlanApproval(
    subprocessId: string,
    planMarkdown: string,
  ): Effect.Effect<ApprovalResult, ApprovalTimeoutError | DatabaseError>;

  /**
   * Block until the user approves or rejects a PRD.
   * Mirrors waitForPlanApproval but uses prd-specific DB columns.
   */
  waitForPrdApproval(
    subprocessId: string,
    prdMarkdown: string,
  ): Effect.Effect<ApprovalResult, ApprovalTimeoutError | DatabaseError>;

  /**
   * Thin Deferred-wait only — used by the ExitPlanMode SDK callback flow
   * (tool-permissions.ts) which manages its own DB state.
   * Creates a Deferred and awaits user response with a 5-hour timeout.
   */
  requestPlanApproval(
    subprocessId: string,
  ): Effect.Effect<ApprovalResult, ApprovalTimeoutError>;

  /**
   * Resolve a pending plan-approval Deferred.
   * If no Deferred is pending (agent is paused/dead), stores the result in DB
   * for consumption on resume. Persists feedback as a user message if rejecting.
   */
  submitPlanApproval(
    subprocessId: string,
    approved: boolean,
    feedback?: string,
  ): Effect.Effect<void>;

  /**
   * Resolve a pending PRD-approval Deferred.
   * Same pattern as submitPlanApproval for the PRD flow.
   */
  submitPrdApproval(
    subprocessId: string,
    approved: boolean,
    feedback?: string,
  ): Effect.Effect<void>;
}

/** Context tag for the PlanApproval service */
export class PlanApproval extends Effect.Tag("PlanApproval")<
  PlanApproval,
  PlanApprovalService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const PlanApprovalLive = Layer.effect(
  PlanApproval,
  Effect.gen(function* () {
    const database = yield* Database;
    const persistence = yield* SessionPersistence;
    const broadcaster = yield* EventBroadcaster;

    // Internal Deferred maps — one entry per pending request, keyed by subprocessId
    const planDeferreds = new Map<string, Deferred.Deferred<ApprovalResult>>();
    const prdDeferreds = new Map<string, Deferred.Deferred<ApprovalResult>>();

    // -----------------------------------------------------------------------
    // Internal helper: get session DB ID and feature ID for a subprocess
    // -----------------------------------------------------------------------
    const getSessionInfo = (subprocessId: string) =>
      Effect.gen(function* () {
        const sessionDbId = yield* persistence.getSessionDbId(subprocessId);
        if (!sessionDbId) return { sessionDbId: null, featureId: null };
        const row = yield* database
          .queryOne<{ feature_id: number }>(
            "SELECT feature_id FROM agent_sessions WHERE id = ?",
            sessionDbId,
          )
          .pipe(Effect.orElseSucceed(() => null));
        return { sessionDbId, featureId: row?.feature_id ?? null };
      });

    // -----------------------------------------------------------------------
    // Internal helper: persist a user message (best-effort)
    // -----------------------------------------------------------------------
    const persistUserMessage = (sessionDbId: number, content: string, featureId: number | null) =>
      database
        .execute(
          "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
          sessionDbId,
          "user",
          content,
          "user_message",
          null,
        )
        .pipe(
          Effect.andThen(
            featureId != null
              ? broadcaster.notifyDbUpdated("agent_session", featureId)
              : Effect.void,
          ),
          Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to persist user message", { error: e })),
          Effect.orElse(() => Effect.void),
        );

    return {
      // -----------------------------------------------------------------------
      // waitForPlanApproval
      // -----------------------------------------------------------------------
      waitForPlanApproval: (subprocessId: string, planMarkdown: string) =>
        Effect.gen(function* () {
          const { sessionDbId, featureId } = yield* getSessionInfo(subprocessId);

          // 0. Check for a stored approval result (set when user approved while agent was paused)
          if (sessionDbId) {
            const stored = yield* database
              .queryOne<{ plan_approval_result: string | null }>(
                "SELECT plan_approval_result FROM agent_sessions WHERE id = ?",
                sessionDbId,
              )
              .pipe(Effect.orElseSucceed(() => null));

            if (stored?.plan_approval_result) {
              const result = yield* Effect.try({
                try: () => JSON.parse(stored.plan_approval_result!) as ApprovalResult,
                catch: () =>
                  new DatabaseError({ operation: "parsePlanApprovalResult", cause: "malformed JSON" }),
              });
              yield* database
                .execute(
                  "UPDATE agent_sessions SET plan_approval_result = NULL, pending_plan_approval = NULL WHERE id = ?",
                  sessionDbId,
                )
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to clear plan_approval_result on resume", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
              if (featureId != null) {
                yield* broadcaster
                  .notifyDbUpdated("agent_session", featureId)
                  .pipe(
                    Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after clearing plan_approval_result", { error: e })),
                    Effect.orElse(() => Effect.void),
                  );
              }
              return result;
            }
          }

          // 1. Emit a synthetic tool_call block so the plan renders in the message list
          if (sessionDbId) {
            const syntheticToolUseId = `show_plan_${Date.now()}`;
            const toolArgs = JSON.stringify({ plan: planMarkdown });
            yield* database
              .execute(
                "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id) VALUES (?, ?, ?, ?, ?, ?)",
                sessionDbId,
                "assistant",
                toolArgs,
                "tool_call",
                "mcp__cadence-plan__show_plan",
                syntheticToolUseId,
              )
              .pipe(
                Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to insert synthetic show_plan tool call", { error: e })),
                Effect.orElse(() => Effect.void),
              );
            if (featureId != null) {
              yield* broadcaster
                .notifyDbUpdated("agent_session", featureId)
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after show_plan insert", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
            }
          }

          // 2. Set pending_plan_approval in DB to trigger the approval bar UI
          if (sessionDbId) {
            yield* database
              .execute(
                "UPDATE agent_sessions SET pending_plan_approval = ? WHERE id = ?",
                JSON.stringify({ plan: planMarkdown }),
                sessionDbId,
              )
              .pipe(
                Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to set pending_plan_approval", { error: e })),
                Effect.orElse(() => Effect.void),
              );
            if (featureId != null) {
              yield* broadcaster
                .notifyDbUpdated("agent_session", featureId)
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after setting pending_plan_approval", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
            }
          }

          // 3. Create Deferred and await with 5-hour timeout
          const deferred = yield* Deferred.make<ApprovalResult>();
          planDeferreds.set(subprocessId, deferred);

          const cleanup = Effect.gen(function* () {
            planDeferreds.delete(subprocessId);
            if (sessionDbId) {
              yield* database
                .execute(
                  "UPDATE agent_sessions SET pending_plan_approval = NULL WHERE id = ?",
                  sessionDbId,
                )
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to clear pending_plan_approval in cleanup", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
              if (featureId != null) {
                yield* broadcaster
                  .notifyDbUpdated("agent_session", featureId)
                  .pipe(
                    Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update in plan approval cleanup", { error: e })),
                    Effect.orElse(() => Effect.void),
                  );
              }
            }
          });

          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutFail({
              duration: Duration.hours(5),
              onTimeout: () => new ApprovalTimeoutError({ subprocessId }),
            }),
            Effect.ensuring(cleanup),
          );
        }),

      // -----------------------------------------------------------------------
      // waitForPrdApproval
      // -----------------------------------------------------------------------
      waitForPrdApproval: (subprocessId: string, prdMarkdown: string) =>
        Effect.gen(function* () {
          const { sessionDbId, featureId } = yield* getSessionInfo(subprocessId);

          // 0. Check for a stored PRD approval result
          if (sessionDbId) {
            const stored = yield* database
              .queryOne<{ prd_approval_result: string | null }>(
                "SELECT prd_approval_result FROM agent_sessions WHERE id = ?",
                sessionDbId,
              )
              .pipe(Effect.orElseSucceed(() => null));

            if (stored?.prd_approval_result) {
              const result = yield* Effect.try({
                try: () => JSON.parse(stored.prd_approval_result!) as ApprovalResult,
                catch: () =>
                  new DatabaseError({ operation: "parsePrdApprovalResult", cause: "malformed JSON" }),
              });
              yield* database
                .execute(
                  "UPDATE agent_sessions SET prd_approval_result = NULL, pending_prd_approval = NULL WHERE id = ?",
                  sessionDbId,
                )
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to clear prd_approval_result on resume", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
              if (featureId != null) {
                yield* broadcaster
                  .notifyDbUpdated("agent_session", featureId)
                  .pipe(
                    Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after clearing prd_approval_result", { error: e })),
                    Effect.orElse(() => Effect.void),
                  );
              }
              return result;
            }
          }

          // 1. Emit a synthetic tool_call block so the PRD renders in the message list
          if (sessionDbId) {
            const syntheticToolUseId = `show_prd_${Date.now()}`;
            const toolArgs = JSON.stringify({ prd: prdMarkdown });
            yield* database
              .execute(
                "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name, tool_use_id) VALUES (?, ?, ?, ?, ?, ?)",
                sessionDbId,
                "assistant",
                toolArgs,
                "tool_call",
                "mcp__cadence-prd__show_prd",
                syntheticToolUseId,
              )
              .pipe(
                Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to insert synthetic show_prd tool call", { error: e })),
                Effect.orElse(() => Effect.void),
              );
            if (featureId != null) {
              yield* broadcaster
                .notifyDbUpdated("agent_session", featureId)
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after show_prd insert", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
            }
          }

          // 2. Set pending_prd_approval in DB to trigger the approval bar UI
          if (sessionDbId) {
            yield* database
              .execute(
                "UPDATE agent_sessions SET pending_prd_approval = ? WHERE id = ?",
                JSON.stringify({ prd: prdMarkdown }),
                sessionDbId,
              )
              .pipe(
                Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to set pending_prd_approval", { error: e })),
                Effect.orElse(() => Effect.void),
              );
            if (featureId != null) {
              yield* broadcaster
                .notifyDbUpdated("agent_session", featureId)
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after setting pending_prd_approval", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
            }
          }

          // 3. Create Deferred and await with 5-hour timeout
          const deferred = yield* Deferred.make<ApprovalResult>();
          prdDeferreds.set(subprocessId, deferred);

          const cleanup = Effect.gen(function* () {
            prdDeferreds.delete(subprocessId);
            if (sessionDbId) {
              yield* database
                .execute(
                  "UPDATE agent_sessions SET pending_prd_approval = NULL WHERE id = ?",
                  sessionDbId,
                )
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to clear pending_prd_approval in cleanup", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
              if (featureId != null) {
                yield* broadcaster
                  .notifyDbUpdated("agent_session", featureId)
                  .pipe(
                    Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update in PRD approval cleanup", { error: e })),
                    Effect.orElse(() => Effect.void),
                  );
              }
            }
          });

          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutFail({
              duration: Duration.hours(5),
              onTimeout: () => new ApprovalTimeoutError({ subprocessId }),
            }),
            Effect.ensuring(cleanup),
          );
        }),

      // -----------------------------------------------------------------------
      // requestPlanApproval (thin Deferred wait — for ExitPlanMode SDK flow)
      // -----------------------------------------------------------------------
      requestPlanApproval: (subprocessId: string) =>
        Effect.gen(function* () {
          const deferred = yield* Deferred.make<ApprovalResult>();
          planDeferreds.set(subprocessId, deferred);

          return yield* Deferred.await(deferred).pipe(
            Effect.timeoutFail({
              duration: Duration.hours(5),
              onTimeout: () => new ApprovalTimeoutError({ subprocessId }),
            }),
            Effect.ensuring(Effect.sync(() => planDeferreds.delete(subprocessId))),
          );
        }),

      // -----------------------------------------------------------------------
      // submitPlanApproval
      // -----------------------------------------------------------------------
      submitPlanApproval: (subprocessId: string, approved: boolean, feedback?: string) =>
        Effect.gen(function* () {
          const deferred = planDeferreds.get(subprocessId);

          if (deferred) {
            const resolved = yield* Deferred.succeed(deferred, { approved, feedback });
            if (!resolved) {
              yield* Effect.logWarning("Plan approval submission arrived after timeout", { subprocessId });
            }

            // If rejecting with feedback, persist as a user message in DB
            if (!approved && feedback) {
              const { sessionDbId, featureId } = yield* getSessionInfo(subprocessId);
              if (sessionDbId) {
                const content = `**Plan feedback:**\n${feedback}`;
                yield* persistUserMessage(sessionDbId, content, featureId);
              }
            }
          } else {
            // No Deferred pending — agent is paused/dead. Store for consumption on resume.
            const { sessionDbId, featureId } = yield* getSessionInfo(subprocessId);
            if (sessionDbId) {
              yield* database
                .execute(
                  "UPDATE agent_sessions SET plan_approval_result = ?, pending_plan_approval = NULL WHERE id = ?",
                  JSON.stringify({ approved, feedback }),
                  sessionDbId,
                )
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to store plan_approval_result for paused agent", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
              if (featureId != null) {
                yield* broadcaster
                  .notifyDbUpdated("agent_session", featureId)
                  .pipe(
                    Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after storing plan_approval_result", { error: e })),
                    Effect.orElse(() => Effect.void),
                  );
              }
            }
          }
        }),

      // -----------------------------------------------------------------------
      // submitPrdApproval
      // -----------------------------------------------------------------------
      submitPrdApproval: (subprocessId: string, approved: boolean, feedback?: string) =>
        Effect.gen(function* () {
          const deferred = prdDeferreds.get(subprocessId);

          if (deferred) {
            const resolved = yield* Deferred.succeed(deferred, { approved, feedback });
            if (!resolved) {
              yield* Effect.logWarning("PRD approval submission arrived after timeout", { subprocessId });
            }

            // If rejecting with feedback, persist as a user message in DB
            if (!approved && feedback) {
              const { sessionDbId, featureId } = yield* getSessionInfo(subprocessId);
              if (sessionDbId) {
                const content = `**PRD feedback:**\n${feedback}`;
                yield* persistUserMessage(sessionDbId, content, featureId);
              }
            }
          } else {
            // No Deferred pending — agent is paused/dead. Store for consumption on resume.
            const { sessionDbId, featureId } = yield* getSessionInfo(subprocessId);
            if (sessionDbId) {
              yield* database
                .execute(
                  "UPDATE agent_sessions SET prd_approval_result = ?, pending_prd_approval = NULL WHERE id = ?",
                  JSON.stringify({ approved, feedback }),
                  sessionDbId,
                )
                .pipe(
                  Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to store prd_approval_result for paused agent", { error: e })),
                  Effect.orElse(() => Effect.void),
                );
              if (featureId != null) {
                yield* broadcaster
                  .notifyDbUpdated("agent_session", featureId)
                  .pipe(
                    Effect.tapError((e) => Effect.logWarning("PlanApproval: Failed to notify DB update after storing prd_approval_result", { error: e })),
                    Effect.orElse(() => Effect.void),
                  );
              }
            }
          }
        }),
    };
  }),
);
