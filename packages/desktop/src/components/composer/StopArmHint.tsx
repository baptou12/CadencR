import { memo, type ReactElement } from "react";
import { stopArmKeyFor, useStopArmStore } from "@/stores/stop-arm-store";
import { useComposerContext } from "./ComposerContext";

/**
 * After the first Esc while the agent works, states the second press out loud
 * (and to screen readers) instead of stopping on a single, reflexive Esc.
 */
export const StopArmHint = memo(function StopArmHint(): ReactElement | null {
  const { wsSessionId, featureId, isRunning } = useComposerContext();
  const armed = useStopArmStore(
    (state) => state.armedKey !== null && state.armedKey === stopArmKeyFor(wsSessionId, featureId),
  );
  if (!armed || !isRunning) return null;
  return (
    <span
      role="status"
      className="composer-stop-arm inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-destructive"
    >
      Press
      <kbd className="rounded border border-destructive/40 px-1 font-mono text-[11px]">esc</kbd>
      again to stop
    </span>
  );
});
