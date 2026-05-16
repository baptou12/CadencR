import { useEffect, useState } from "react";
import type { TurnLifecycle } from "@/stores/ws-turn-lifecycle";
import {
  elapsedTurnTiming,
  formatTurnDuration,
  type TurnTimingState,
} from "@/stores/ws-turn-timing";

export function isTurnInProgress(lifecycle: TurnLifecycle | undefined): boolean {
  return lifecycle?.phase === "active" || lifecycle?.phase === "paused";
}

export function useTurnWorkingLabel(
  lifecycle: TurnLifecycle | undefined,
  turnTiming: TurnTimingState | undefined,
): string {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!isTurnInProgress(lifecycle)) return undefined;
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [lifecycle]);

  const elapsed = lifecycle && turnTiming ? elapsedTurnTiming(turnTiming, lifecycle, nowMs) : null;
  return elapsed ? `Working - ${formatTurnDuration(elapsed.totalMs)}` : "Working";
}
