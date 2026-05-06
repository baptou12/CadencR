/**
 * Thin top-of-view progress stripe shown while a soft WS reconnect is in
 * flight (same feature re-mounted). Clears on the first post-reconnect
 * `queue_update`. Satisfies `.claude/rules/explicit-state.md`: no
 * unacknowledged waits.
 */

import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";

export function ReconnectIndicator() {
  const isReconnecting = useWorkflowStore((s) => s.isReconnecting);
  if (!isReconnecting) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 top-0 z-50 h-[2px] overflow-hidden bg-primary/10"
      aria-hidden
    >
      <div className="h-full w-1/3 animate-reconnect-slide bg-primary/70" />
    </div>
  );
}
