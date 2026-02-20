import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2Icon, GitMergeIcon } from "lucide-react";
import type { AgentStatus } from "@/components/AgentSession";
import { AGENT_ICONS } from "@/components/agent-icons";
import { KbdShortcut } from "@/components/KbdShortcut";
import { MergeArchiveDialog } from "@/components/MergeArchiveDialog";

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
  canContinueBuild?: boolean;
  onContinueBuild?: () => void;
  isContinuingBuild?: boolean;
  nextStepNumber?: number | null;
  canStartWorkflowSession?: boolean;
  onStartWorkflowSession?: () => void;
  isStartingWorkflowSession?: boolean;
  allPhasesDone?: boolean;
  projectId?: number;
  featureId?: number;
  featureType?: string;
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
  canContinueBuild,
  onContinueBuild,
  isContinuingBuild,
  nextStepNumber,
  canStartWorkflowSession,
  onStartWorkflowSession,
  isStartingWorkflowSession,
  allPhasesDone,
  projectId,
  featureId,
  featureType,
}: NextStepsBarProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

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
        {canContinueBuild && onContinueBuild && (
          <Button
            onClick={onContinueBuild}
            disabled={isContinuingBuild}
          >
            {isContinuingBuild ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <AGENT_ICONS.execute className="mr-2 size-4" />
            )}
            {nextStepNumber != null
              ? `Continue to Step ${nextStepNumber}`
              : "Continue Building"}
            <KbdShortcut keys={["cmd", "shift", "B"]} />
          </Button>
        )}
        {canStartBuild && !canContinueBuild && (
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
            <KbdShortcut keys={["cmd", "shift", "B"]} />
          </Button>
        )}
        {canStartWorkflowSession && onStartWorkflowSession && (
          <Button
            variant="outline"
            onClick={onStartWorkflowSession}
            disabled={isStartingWorkflowSession}
          >
            {isStartingWorkflowSession ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <AGENT_ICONS.session className="mr-2 size-4" />
            )}
            Start Session
            <KbdShortcut keys={["cmd", "shift", "S"]} />
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
        {allPhasesDone && featureType === "feature" && projectId != null && featureId != null && (
          <Button
            variant="outline"
            onClick={() => setMergeDialogOpen(true)}
          >
            <GitMergeIcon className="mr-2 size-4" />
            Merge &amp; Archive
          </Button>
        )}
      </div>

      {allPhasesDone && featureType === "feature" && projectId != null && featureId != null && (
        <MergeArchiveDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          projectId={projectId}
          featureId={featureId}
        />
      )}
    </div>
  );
}
