import type { TurnLifecycle } from "./ws-turn-lifecycle";

export interface TurnDurationBreakdown {
  totalMs: number;
  activeMs: number;
  userPendingMs: number;
}

export interface TurnTimingState {
  startedAt: number | null;
  segmentStartedAt: number | null;
  activeMs: number;
  userPendingMs: number;
  completed: TurnDurationBreakdown | null;
}

export function createTurnTiming(): TurnTimingState {
  return {
    startedAt: null,
    segmentStartedAt: null,
    activeMs: 0,
    userPendingMs: 0,
    completed: null,
  };
}

export function transitionTurnTiming(
  timing: TurnTimingState,
  previous: TurnLifecycle,
  next: TurnLifecycle,
  nowMs: number = Date.now(),
): TurnTimingState {
  if (previous.phase === "idle" && next.phase === "active") {
    return startTurnTiming(nowMs);
  }

  if (previous.phase === "terminal" && next.phase === "active") {
    return startTurnTiming(nowMs);
  }

  if (previous.phase === "error" && next.phase === "active") {
    return startTurnTiming(nowMs);
  }

  return completeTurnTimingSegment(timing, previous, next, timing.segmentStartedAt, nowMs);
}

export function completeTurnTimingSegment(
  timing: TurnTimingState,
  previous: TurnLifecycle,
  next: TurnLifecycle,
  segmentStartedAt: number | null,
  nowMs: number,
): TurnTimingState {
  const segmentMs = segmentStartedAt == null ? 0 : Math.max(0, nowMs - segmentStartedAt);
  const activeMs = timing.activeMs + (previous.phase === "active" ? segmentMs : 0);
  const userPendingMs = timing.userPendingMs + (isUserPendingLifecycle(previous) ? segmentMs : 0);
  const completed =
    isTerminalLifecycle(next) && timing.startedAt != null
      ? {
          totalMs: Math.max(0, nowMs - timing.startedAt),
          activeMs,
          userPendingMs,
        }
      : timing.completed;

  return {
    startedAt: next.phase === "idle" ? null : timing.startedAt,
    segmentStartedAt: isTerminalLifecycle(next) || next.phase === "idle" ? null : nowMs,
    activeMs: next.phase === "idle" ? 0 : activeMs,
    userPendingMs: next.phase === "idle" ? 0 : userPendingMs,
    completed,
  };
}

export function elapsedTurnTiming(
  timing: TurnTimingState,
  current: TurnLifecycle,
  nowMs: number = Date.now(),
): TurnDurationBreakdown | null {
  if (timing.startedAt == null) return timing.completed;

  const segmentMs =
    timing.segmentStartedAt == null ? 0 : Math.max(0, nowMs - timing.segmentStartedAt);
  return {
    totalMs: Math.max(0, nowMs - timing.startedAt),
    activeMs: timing.activeMs + (current.phase === "active" ? segmentMs : 0),
    userPendingMs: timing.userPendingMs + (isUserPendingLifecycle(current) ? segmentMs : 0),
  };
}

export function formatTurnDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`;
  return `${seconds}s`;
}

function startTurnTiming(nowMs: number): TurnTimingState {
  return {
    startedAt: nowMs,
    segmentStartedAt: nowMs,
    activeMs: 0,
    userPendingMs: 0,
    completed: null,
  };
}

function isTerminalLifecycle(lifecycle: TurnLifecycle): boolean {
  return lifecycle.phase === "terminal" || lifecycle.phase === "error";
}

function isUserPendingLifecycle(lifecycle: TurnLifecycle): boolean {
  return (
    lifecycle.phase === "paused" &&
    (lifecycle.reason === "permission" ||
      lifecycle.reason === "question" ||
      lifecycle.reason === "planApproval")
  );
}
