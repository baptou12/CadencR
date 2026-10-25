import { memo } from "react";
import { Play, Square } from "lucide-react";
import { useIsLatestBlock } from "@/hooks/useIsLatestBlock";
import { CONTINUE_PROMPT } from "@/lib/agent-error-presentation";
import { useAgentSessionContext } from "./agent-session/agent-session-context";

/**
 * Where the user stopped a turn. States it in the product's words instead of
 * the provider's raw "tool use was rejected" text, and — on the turn that just
 * ended — offers to pick the work back up.
 */
export const TurnInterruptedMarker = memo(function TurnInterruptedMarker({
  blockId,
}: {
  blockId: string;
}) {
  const { wsSessionId, sendPrompt } = useAgentSessionContext();
  const isLatest = useIsLatestBlock(wsSessionId, blockId);
  return (
    <div
      data-turn-interrupted
      className="my-2 flex items-center gap-3 text-xs text-muted-foreground"
      role="note"
    >
      <span className="h-px flex-1 bg-border/70" aria-hidden />
      <span className="inline-flex items-center gap-1.5">
        <Square className="size-2.5 fill-current" aria-hidden />
        Stopped by you
      </span>
      {isLatest && (
        <button
          type="button"
          onClick={() => sendPrompt(CONTINUE_PROMPT)}
          className="composer-instrument gap-1.5 text-foreground"
        >
          <Play className="size-3" aria-hidden />
          Resume
        </button>
      )}
      <span className="h-px flex-1 bg-border/70" aria-hidden />
    </div>
  );
});
