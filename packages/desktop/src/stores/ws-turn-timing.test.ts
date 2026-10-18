import { describe, expect, it } from "vitest";
import type { TurnLifecycle } from "./ws-turn-lifecycle";
import {
  anchorTurnTiming,
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

  it("starts the timer when bootstrapping straight into a paused gate", () => {
    // Sessions hydrated from a persisted snapshot can land directly in a
    // paused state (pending question / permission) without ever going
    // through `idle → active`. The live "Working - Xs" label has to start
    // ticking from this entry point too, otherwise the UI stays on a bare
    // "Working" until the gate resolves.
    let timing = createTurnTiming();

    timing = transitionTurnTiming(timing, { phase: "idle" }, questionPaused, 1_000);

    expect(timing.startedAt).toBe(1_000);
    expect(elapsedTurnTiming(timing, questionPaused, 4_500)?.totalMs).toBe(3_500);

    timing = transitionTurnTiming(timing, questionPaused, active, 6_000);
    timing = transitionTurnTiming(timing, active, terminal, 8_000);

    expect(timing.completed).toEqual({
      totalMs: 7_000,
      activeMs: 2_000,
      userPendingMs: 5_000,
    });
  });

  it("restarts the timer when a paused turn ends and the next one bootstraps paused again", () => {
    let timing = createTurnTiming();
    timing = transitionTurnTiming(timing, { phase: "idle" }, questionPaused, 1_000);
    timing = transitionTurnTiming(timing, questionPaused, terminal, 5_000);

    timing = transitionTurnTiming(timing, terminal, permissionPaused, 10_000);
    expect(timing.startedAt).toBe(10_000);
    expect(timing.completed).toBeNull();
    expect(elapsedTurnTiming(timing, permissionPaused, 12_500)?.totalMs).toBe(2_500);
  });

  it("formats durations using seconds, then minutes, then hours", () => {
    expect(formatTurnDuration(4_400)).toBe("4s");
    expect(formatTurnDuration(65_000)).toBe("1m 5s");
    expect(formatTurnDuration(3_665_000)).toBe("1h 1m 5s");
  });

  describe("anchorTurnTiming", () => {
    it("moves an open first segment back to the server start", () => {
      const timing = transitionTurnTiming(createTurnTiming(), { phase: "idle" }, active, 50_000);

      const anchored = anchorTurnTiming(timing, active, 40_000);

      expect(anchored.startedAt).toBe(40_000);
      expect(anchored.segmentStartedAt).toBe(40_000);
      expect(elapsedTurnTiming(anchored, active, 52_000)?.activeMs).toBe(12_000);
    });

    it("counts unobserved time as active once a segment has closed", () => {
      let timing = transitionTurnTiming(createTurnTiming(), { phase: "idle" }, active, 50_000);
      timing = transitionTurnTiming(timing, active, permissionPaused, 51_000);

      const anchored = anchorTurnTiming(timing, permissionPaused, 40_000);

      expect(anchored.startedAt).toBe(40_000);
      expect(anchored.segmentStartedAt).toBe(51_000);
      expect(elapsedTurnTiming(anchored, permissionPaused, 53_000)).toEqual({
        totalMs: 13_000,
        activeMs: 11_000,
        userPendingMs: 2_000,
      });
    });

    it("counts a gated turn joined mid-way as active up to the moment it was seen", () => {
      const anchored = anchorTurnTiming(createTurnTiming(), questionPaused, 7_000, 10_000);

      expect(anchored.startedAt).toBe(7_000);
      expect(elapsedTurnTiming(anchored, questionPaused, 12_000)).toEqual({
        totalMs: 5_000,
        activeMs: 3_000,
        userPendingMs: 2_000,
      });
    });

    it("starts a turn that has no timing yet and leaves settled turns alone", () => {
      expect(anchorTurnTiming(createTurnTiming(), active, 7_000).startedAt).toBe(7_000);

      const idle = createTurnTiming();
      expect(anchorTurnTiming(idle, { phase: "idle" }, 7_000)).toBe(idle);
      const same = transitionTurnTiming(createTurnTiming(), { phase: "idle" }, active, 7_000);
      expect(anchorTurnTiming(same, active, 7_000)).toBe(same);
      expect(anchorTurnTiming(same, active, null)).toBe(same);
    });
  });
});
