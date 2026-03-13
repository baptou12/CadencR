import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  SessionNotFoundError,
  SubprocessAlreadyRunningError,
  InvalidStateTransitionError,
  DispatchConflictError,
  PhaseNotFoundError,
  PlanNotFoundError,
} from "./errors.js";

describe("Domain error classes", () => {
  it("SessionNotFoundError has correct tag and data", () => {
    const err = new SessionNotFoundError({ sessionId: 42 });
    expect(err._tag).toBe("SessionNotFoundError");
    expect(err.sessionId).toBe(42);
  });

  it("SubprocessAlreadyRunningError has correct tag and data", () => {
    const err = new SubprocessAlreadyRunningError({ subprocessId: "agent-123" });
    expect(err._tag).toBe("SubprocessAlreadyRunningError");
    expect(err.subprocessId).toBe("agent-123");
  });

  it("InvalidStateTransitionError has correct tag and data", () => {
    const err = new InvalidStateTransitionError({
      sessionId: 1,
      currentStatus: "completed",
      targetStatus: "running",
    });
    expect(err._tag).toBe("InvalidStateTransitionError");
    expect(err.sessionId).toBe(1);
    expect(err.currentStatus).toBe("completed");
    expect(err.targetStatus).toBe("running");
  });

  it("DispatchConflictError has correct tag and data", () => {
    const err = new DispatchConflictError({ featureId: 7 });
    expect(err._tag).toBe("DispatchConflictError");
    expect(err.featureId).toBe(7);
  });

  it("PhaseNotFoundError has correct tag and data", () => {
    const err = new PhaseNotFoundError({ phaseId: 99 });
    expect(err._tag).toBe("PhaseNotFoundError");
    expect(err.phaseId).toBe(99);
  });

  it("PlanNotFoundError has correct tag and data", () => {
    const err = new PlanNotFoundError({ planId: 5 });
    expect(err._tag).toBe("PlanNotFoundError");
    expect(err.planId).toBe(5);
  });

  it("errors can be caught with Effect.catchTag", () => {
    const program = Effect.fail(new SessionNotFoundError({ sessionId: 10 })).pipe(
      Effect.catchTag("SessionNotFoundError", (e) =>
        Effect.succeed(`caught:${e.sessionId}`),
      ),
    );
    const result = Effect.runSync(program);
    expect(result).toBe("caught:10");
  });

  it("errors can be caught with Effect.catchTag — DispatchConflictError", () => {
    const program = Effect.fail(new DispatchConflictError({ featureId: 3 })).pipe(
      Effect.catchTag("DispatchConflictError", (e) =>
        Effect.succeed(`conflict:${e.featureId}`),
      ),
    );
    const result = Effect.runSync(program);
    expect(result).toBe("conflict:3");
  });
});
