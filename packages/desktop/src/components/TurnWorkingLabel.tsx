import { useNow } from "@/hooks/useNow";
import { isTurnInProgress, type TurnLifecycle } from "@/stores/ws-turn-lifecycle";
import {
  elapsedTurnTiming,
  formatTurnDuration,
  type TurnTimingState,
} from "@/stores/ws-turn-timing";

export function useTurnWorkingLabel(
  lifecycle: TurnLifecycle | undefined,
  turnTiming: TurnTimingState | undefined,
): string {
  const startedAt = turnTiming?.startedAt ?? null;
  const nowMs = useNow(isTurnInProgress(lifecycle) && startedAt != null, 1_000, startedAt);
  const elapsed = lifecycle && turnTiming ? elapsedTurnTiming(turnTiming, lifecycle, nowMs) : null;
  return elapsed ? `Working - ${formatTurnDuration(elapsed.totalMs)}` : "Working";
}
