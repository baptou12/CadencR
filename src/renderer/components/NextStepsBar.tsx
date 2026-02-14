import { Button } from "@/components/ui/button";
import { Loader2Icon } from "lucide-react";
import type { AgentStatus } from "@/components/AgentSession";
import { AGENT_ICONS } from "@/components/agent-icons";

interface NextStepsBarProps {
  show: boolean;
  canStartBuild: boolean;
  canStartRisk: boolean;
  canStartReview: boolean;
  executeStatus: AgentStatus;
  onStartBuilding: () => void;
  onStartRisk: () => void;
  onStartReview: () => void;
  isStartingExecute: boolean;
  isStartingRisk: boolean;
  isStartingReview: boolean;
}

export function NextStepsBar({
  show,
  canStartBuild,
  canStartRisk,
  canStartReview,
  executeStatus,
  onStartBuilding,
  onStartRisk,
  onStartReview,
  isStartingExecute,
  isStartingRisk,
  isStartingReview,
}: NextStepsBarProps) {
  if (!show) return null;

  return (
    <div className="space-y-3 pt-4">
      <div>
        <h3 className="text-sm font-semibold">Next Steps</h3>
        <p className="text-xs text-muted-foreground">
          {canStartBuild && executeStatus === "error"
            ? "Some phases failed. Retry to re-run the errored phases."
            : canStartBuild
              ? "The plan is ready. Start building to execute all phases, or evaluate risks first."
              : "Run a review or risk analysis on the current implementation."}
        </p>
      </div>
      <div className="flex gap-2">
        {canStartBuild && (
          <Button
            onClick={onStartBuilding}
            disabled={isStartingExecute}
          >
            {isStartingExecute ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <AGENT_ICONS.execute className="mr-2 size-4" />
            )}
            {executeStatus === "error" ? "Retry Build" : "Start Building"}
          </Button>
        )}
        {canStartRisk && (
          <Button
            variant="outline"
            onClick={onStartRisk}
            disabled={isStartingRisk}
          >
            {isStartingRisk ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <AGENT_ICONS.risk className="mr-2 size-4" />
            )}
            Evaluate Risk
          </Button>
        )}
        {canStartReview && (
          <Button
            variant="outline"
            onClick={onStartReview}
            disabled={isStartingReview}
          >
            {isStartingReview ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <AGENT_ICONS.review className="mr-2 size-4" />
            )}
            Start Review
          </Button>
        )}
      </div>
    </div>
  );
}
