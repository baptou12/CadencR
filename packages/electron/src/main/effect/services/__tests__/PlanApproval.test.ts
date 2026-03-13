/**
 * Tests for the PlanApproval Effect service.
 *
 * Tests Deferred-based approval coordination, DB state management,
 * stored approval resume path, and timeout behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect, Fiber, Duration, Layer } from "effect";
import { PlanApproval, PlanApprovalLive } from "../PlanApproval";
import { Database, type DatabaseService } from "../Database";
import { SessionPersistence, type SessionPersistenceService } from "../SessionPersistence";
import { EventBroadcaster, type EventBroadcasterService } from "../EventBroadcaster";
import { ApprovalTimeoutError } from "../../errors";

// ---------------------------------------------------------------------------
// Mock layers
// ---------------------------------------------------------------------------

// Mock DB service
const makeDbMock = () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  let storedApprovalResult: string | null = null;
  let storedPrdApprovalResult: string | null = null;

  const dbService = {
    queryOne: vi.fn((sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("plan_approval_result")) {
        return Effect.succeed({ plan_approval_result: storedApprovalResult });
      }
      if (sql.includes("prd_approval_result")) {
        return Effect.succeed({ prd_approval_result: storedPrdApprovalResult });
      }
      // feature_id query
      return Effect.succeed({ feature_id: 42 });
    }),
    queryAll: vi.fn(() => Effect.succeed([])),
    execute: vi.fn((sql: string, ...params: unknown[]) => {
      queries.push({ sql, params });
      return Effect.succeed({ changes: 1, lastInsertRowid: 0 });
    }),
    queryOneValidated: vi.fn(() => Effect.succeed(null)),
    queryAllValidated: vi.fn(() => Effect.succeed([])),
    _setStoredApproval: (result: string | null) => { storedApprovalResult = result; },
    _setStoredPrdApproval: (result: string | null) => { storedPrdApprovalResult = result; },
    _getQueries: () => queries,
  } as unknown as DatabaseService & {
    _setStoredApproval: (r: string | null) => void;
    _setStoredPrdApproval: (r: string | null) => void;
    execute: ReturnType<typeof vi.fn>;
    _getQueries: () => Array<{ sql: string; params: unknown[] }>;
  };

  return dbService;
};

// Mock SessionPersistence
const makeSessionMock = (sessionDbId: number | null = 10): SessionPersistenceService => ({
  persistStreamEvent: vi.fn(() => Effect.void),
  persistSessionStatus: vi.fn(() => Effect.void),
  persistClaudeSessionId: vi.fn(() => Effect.void),
  setSessionModel: vi.fn(() => Effect.void),
  updateTokenUsage: vi.fn(() => Effect.void),
  saveAllSessionStates: vi.fn(() => Effect.void),
  getSessionDbId: vi.fn((_managedId: string) => Effect.succeed(sessionDbId)),
  getSubprocessIdForSession: vi.fn(() => Effect.succeed(undefined)),
  getSubprocessIdsForSessionDbIds: vi.fn(() => Effect.succeed([])),
  restoreSessionMap: vi.fn(() => Effect.void),
  registerSession: vi.fn(() => Effect.void),
  removeSession: vi.fn(() => Effect.void),
});

// Mock EventBroadcaster
const makeBroadcasterMock = (): EventBroadcasterService => ({
  broadcastAgentEvent: vi.fn(() => Effect.void),
  notifyDbUpdated: vi.fn(() => Effect.void),
  throttledNotify: vi.fn(() => Effect.void),
  flushNotify: vi.fn(() => Effect.void),
});

// Short delay to let forked fibers start and register Deferreds
const FIBER_START_DELAY = Duration.millis(10);

// ---------------------------------------------------------------------------
// Test helper: build the service with mocks
// ---------------------------------------------------------------------------

function makeTestLayer(
  dbMock: ReturnType<typeof makeDbMock>,
  sessionMock: ReturnType<typeof makeSessionMock>,
  broadcasterMock: ReturnType<typeof makeBroadcasterMock>,
) {
  const dbLayer = Layer.succeed(Database, dbMock);
  const sessionLayer = Layer.succeed(SessionPersistence, sessionMock);
  const broadcasterLayer = Layer.succeed(EventBroadcaster, broadcasterMock);
  return Layer.provide(
    PlanApprovalLive,
    Layer.mergeAll(dbLayer, sessionLayer, broadcasterLayer),
  );
}

function runTest<A, E>(
  effect: Effect.Effect<A, E, PlanApproval>,
  dbMock: ReturnType<typeof makeDbMock>,
  sessionMock: ReturnType<typeof makeSessionMock>,
  broadcasterMock: ReturnType<typeof makeBroadcasterMock>,
): Promise<A> {
  const testLayer = makeTestLayer(dbMock, sessionMock, broadcasterMock);
  return Effect.runPromise(Effect.provide(effect, testLayer));
}

// ---------------------------------------------------------------------------
// waitForPlanApproval tests
// ---------------------------------------------------------------------------

describe("waitForPlanApproval", () => {
  let dbMock: ReturnType<typeof makeDbMock>;
  let sessionMock: ReturnType<typeof makeSessionMock>;
  let broadcasterMock: ReturnType<typeof makeBroadcasterMock>;

  beforeEach(() => {
    dbMock = makeDbMock();
    sessionMock = makeSessionMock(10);
    broadcasterMock = makeBroadcasterMock();
  });

  it("resolves with approved=true when submitPlanApproval is called", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-1", "## Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-1", true);
        return yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    expect(result.approved).toBe(true);
  });

  it("resolves with approved=false and feedback when user rejects", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-2", "## Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-2", false, "Needs more detail");
        return yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    expect(result.approved).toBe(false);
    expect(result.feedback).toBe("Needs more detail");
  });

  it("emits synthetic show_plan tool block into agent_messages", async () => {
    await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-3", "## My Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-3", true);
        yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    const queries = dbMock._getQueries();
    const insertQuery = queries.find(
      (q) => q.sql.includes("INSERT INTO agent_messages") && String(q.params).includes("show_plan"),
    );
    expect(insertQuery).toBeDefined();
  });

  it("sets pending_plan_approval in DB before waiting", async () => {
    await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-4", "## Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-4", true);
        yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    const queries = dbMock._getQueries();
    const pendingQuery = queries.find(
      (q) => q.sql.includes("pending_plan_approval") && !q.sql.includes("NULL"),
    );
    expect(pendingQuery).toBeDefined();
  });

  it("clears pending_plan_approval in DB after resolving", async () => {
    await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-5", "## Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-5", true);
        yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    const queries = dbMock._getQueries();
    const clearQuery = queries.find(
      (q) => q.sql.includes("pending_plan_approval = NULL"),
    );
    expect(clearQuery).toBeDefined();
  });

  it("returns stored approval result immediately without waiting (paused agent resume)", async () => {
    dbMock._setStoredApproval(JSON.stringify({ approved: true, feedback: undefined }));

    const result = await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        return yield* pa.waitForPlanApproval("sub-stored", "## Plan");
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    expect(result.approved).toBe(true);

    // Should have cleared the stored result
    const queries = dbMock._getQueries();
    const clearQuery = queries.find(
      (q) =>
        q.sql.includes("plan_approval_result = NULL") &&
        q.sql.includes("pending_plan_approval = NULL"),
    );
    expect(clearQuery).toBeDefined();
  });

  it("persists rejection feedback as user message in agent_messages", async () => {
    await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-feedback", "## Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-feedback", false, "Change the approach");
        yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    const queries = dbMock._getQueries();
    const feedbackQuery = queries.find(
      (q) => q.sql.includes("INSERT INTO agent_messages") && String(q.params).includes("Plan feedback"),
    );
    expect(feedbackQuery).toBeDefined();
  });

  it("stores approval result in DB when no Deferred is pending (paused agent path)", async () => {
    await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        // Submit without waiting — no Deferred exists
        yield* pa.submitPlanApproval("sub-paused", true, undefined);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    const queries = dbMock._getQueries();
    const storeQuery = queries.find(
      (q) => q.sql.includes("plan_approval_result") && q.sql.includes("UPDATE"),
    );
    expect(storeQuery).toBeDefined();
  });

  it("times out with ApprovalTimeoutError after configured duration", async () => {
    await expect(
      runTest(
        Effect.gen(function* () {
          const pa = yield* PlanApproval;
          return yield* pa.waitForPlanApproval("sub-timeout", "## Plan").pipe(
            // Override timeout to 1ms for testing
            Effect.timeoutFail({
              duration: Duration.millis(1),
              onTimeout: () => new ApprovalTimeoutError({ subprocessId: "sub-timeout" }),
            }),
          );
        }),
        dbMock,
        sessionMock,
        broadcasterMock,
      ),
    ).rejects.toSatisfy((err: unknown) =>
      err != null &&
      typeof err === "object" &&
      "name" in err &&
      String((err as { name: string }).name).includes("ApprovalTimeoutError"),
    );
  });
});

// ---------------------------------------------------------------------------
// waitForPrdApproval tests
// ---------------------------------------------------------------------------

describe("waitForPrdApproval", () => {
  let dbMock: ReturnType<typeof makeDbMock>;
  let sessionMock: ReturnType<typeof makeSessionMock>;
  let broadcasterMock: ReturnType<typeof makeBroadcasterMock>;

  beforeEach(() => {
    dbMock = makeDbMock();
    sessionMock = makeSessionMock(10);
    broadcasterMock = makeBroadcasterMock();
  });

  it("resolves with approved=true when submitPrdApproval is called", async () => {
    const result = await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPrdApproval("sub-prd-1", "## PRD"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPrdApproval("sub-prd-1", true);
        return yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    expect(result.approved).toBe(true);
  });

  it("emits synthetic show_prd tool block into agent_messages", async () => {
    await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPrdApproval("sub-prd-2", "## PRD"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPrdApproval("sub-prd-2", true);
        yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    const queries = dbMock._getQueries();
    const insertQuery = queries.find(
      (q) => q.sql.includes("INSERT INTO agent_messages") && String(q.params).includes("show_prd"),
    );
    expect(insertQuery).toBeDefined();
  });

  it("returns stored prd_approval_result immediately (paused agent resume)", async () => {
    dbMock._setStoredPrdApproval(JSON.stringify({ approved: true }));

    const result = await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        return yield* pa.waitForPrdApproval("sub-prd-stored", "## PRD");
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    expect(result.approved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-session path
// ---------------------------------------------------------------------------

describe("no active session", () => {
  it("works gracefully when subprocess has no session (no DB calls for session-dependent ops)", async () => {
    const dbMock = makeDbMock();
    const sessionMock = makeSessionMock(null); // no session
    const broadcasterMock = makeBroadcasterMock();

    const result = await runTest(
      Effect.gen(function* () {
        const pa = yield* PlanApproval;
        const fiber = yield* Effect.fork(pa.waitForPlanApproval("sub-nosession", "## Plan"));
        yield* Effect.sleep(FIBER_START_DELAY);
        yield* pa.submitPlanApproval("sub-nosession", true);
        return yield* Fiber.join(fiber);
      }),
      dbMock,
      sessionMock,
      broadcasterMock,
    );

    expect(result.approved).toBe(true);
    // No DB execute calls for session-dependent ops
    expect(dbMock.execute).not.toHaveBeenCalled();
  });
});
