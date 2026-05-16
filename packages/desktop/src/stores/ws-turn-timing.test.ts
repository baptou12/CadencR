import { describe, expect, it } from "vitest";
import type { TurnLifecycle } from "./ws-turn-lifecycle";
import {
  createTurnTiming,
  completeTurnTimingSegment,
  elapsedTurnTiming,
  formatTurnDuration,
  transitionTurnTiming,
} from "./ws-turn-timing";

describe("ws turn timing", () => {
  const active: TurnLifecycle = { phase: "active" };
  const permissionPaused: TurnLifecycle = {
    phase: "paused",
    reason: "permission",
  };
  const questionPaused: TurnLifecycle = { phase: "paused", reason: "question" };
  const planPaused: TurnLifecycle = { phase: "paused", reason: "planApproval" };
  const suspendedPaused: TurnLifecycle = {
    phase: "paused",
    reason: "suspended",
  };
  const terminal: TurnLifecycle = { phase: "terminal", reason: "completed" };

  it("tracks total, active, and user-pending elapsed time across a turn", () => {
    let timing = createTurnTiming();

    timing = transitionTurnTiming(timing, { phase: "idle" }, active, 1_000);
    timing = transitionTurnTiming(timing, active, permissionPaused, 4_000);
    timing = transitionTurnTiming(timing, permissionPaused, active, 9_000);
    timing = transitionTurnTiming(timing, active, questionPaused, 12_000);
    timing = transitionTurnTiming(timing, questionPaused, active, 14_000);
    timing = transitionTurnTiming(timing, active, planPaused, 15_000);
    timing = transitionTurnTiming(timing, planPaused, terminal, 18_000);

    expect(timing.completed).toEqual({
      totalMs: 17_000,
      activeMs: 7_000,
      userPendingMs: 10_000,
    });
  });

  it("keeps total running through user gates but excludes suspended pauses from user wait", () => {
    let timing = createTurnTiming();

    timing = transitionTurnTiming(timing, { phase: "idle" }, active, 1_000);
    timing = transitionTurnTiming(timing, active, suspendedPaused, 3_000);

    expect(elapsedTurnTiming(timing, suspendedPaused, 8_000)).toEqual({
      totalMs: 7_000,
      activeMs: 2_000,
      userPendingMs: 0,
    });
  });

  it("resets the previous completion when a new active turn starts", () => {
    let timing = completeTurnTimingSegment(createTurnTiming(), active, terminal, 1_000, 4_000);

    timing = transitionTurnTiming(timing, terminal, active, 10_000);

    expect(timing.completed).toBeNull();
    expect(elapsedTurnTiming(timing, active, 12_000)?.totalMs).toBe(2_000);
  });

  it("formats durations using seconds, then minutes, then hours", () => {
    expect(formatTurnDuration(4_400)).toBe("4s");
    expect(formatTurnDuration(65_000)).toBe("1m 5s");
    expect(formatTurnDuration(3_665_000)).toBe("1h 1m 5s");
  });
});
