import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Loader2Icon, GitMergeIcon } from "lucide-react";
import type { AgentStatus } from "@/components/AgentSession";
import { AGENT_ICONS } from "@/components/agent-icons";
import { KbdShortcut } from "@/components/KbdShortcut";
import { MergeArchiveDialog } from "@/components/MergeArchiveDialog";
import { AgentPromptBar } from "@/components/AgentPromptBar";
import type { SplitSendAction } from "@/components/AgentPromptBar";

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
  onStartWorkflowSession?: (prompt: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  isStartingWorkflowSession?: boolean;
  allPhasesDone?: boolean;
  projectId?: number;
  featureId?: number;
  featureType?: string;
  canStartRefine?: boolean;
  onStartRefinePlan?: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  onStartRefineBrainstorm?: (description: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  isStartingRefinePlan?: boolean;
  isStartingRefineBrainstorm?: boolean;
  openSessionPrompt?: number;
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
  canStartRefine,
  onStartRefinePlan,
  onStartRefineBrainstorm,
  isStartingRefinePlan,
  isStartingRefineBrainstorm,
  openSessionPrompt,
}: NextStepsBarProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [showRefinePrompt, setShowRefinePrompt] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);

  const canMerge = allPhasesDone && featureType === "feature" && projectId != null && featureId != null;

  const isRefineDisabled = isStartingRefinePlan || isStartingRefineBrainstorm;

  // Close refine prompt when a refine agent starts
  useEffect(() => {
    if (isRefineDisabled) {
      setShowRefinePrompt(false);
    }
  }, [isRefineDisabled]);

  // Close session prompt when session agent starts
  useEffect(() => {
    if (isStartingWorkflowSession) {
      setShowSessionPrompt(false);
    }
  }, [isStartingWorkflowSession]);

  // Open session prompt when triggered externally (e.g. keyboard shortcut)
  useEffect(() => {
    if (openSessionPrompt && openSessionPrompt > 0) {
      setShowSessionPrompt(true);
    }
  }, [openSessionPrompt]);

  // CMD+SHIFT+M: open merge & archive dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "m") {
        if (!canMerge) return;
        e.preventDefault();
        setMergeDialogOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canMerge]);

  const refineSplitActions: SplitSendAction[] = useMemo(
    () => [
      {
        label: "Plan",
        icon: isStartingRefinePlan ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <AGENT_ICONS.plan className="mr-2 size-4" />
        ),
        variant: "default" as const,
        kbdShortcut: ["enter"],
        onClick: (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
          onStartRefinePlan?.(text, images);
        },
      },
      {
        label: "Brainstorm",
        icon: isStartingRefineBrainstorm ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <AGENT_ICONS.brainstorm className="mr-2 size-4" />
        ),
        variant: "outline" as const,
        onClick: (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
          onStartRefineBrainstorm?.(text, images);
        },
      },
    ],
    [isStartingRefinePlan, isStartingRefineBrainstorm, onStartRefinePlan, onStartRefineBrainstorm],
  );

  const sessionSplitActions: SplitSendAction[] = useMemo(
    () => [
      {
        label: "Start Session",
        icon: isStartingWorkflowSession ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <AGENT_ICONS.session className="mr-2 size-4" />
        ),
        variant: "default" as const,
        kbdShortcut: ["enter"],
        onClick: (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
          onStartWorkflowSession?.(text, images);
        },
      },
    ],
    [isStartingWorkflowSession, onStartWorkflowSession],
  );

  if (!show && !canStartRefine) return null;

  return (
    <div className="space-y-3 pt-4">
      {show && (
        <>
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
          <div className="flex flex-wrap gap-2">
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
                onClick={() => setShowSessionPrompt((v) => !v)}
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
            {canStartRefine && (
              <Button
                variant="outline"
                onClick={() => setShowRefinePrompt((v) => !v)}
                disabled={isRefineDisabled}
              >
                {isRefineDisabled ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <AGENT_ICONS.plan className="mr-2 size-4" />
                )}
                Refine
              </Button>
            )}
            {canMerge && (
              <Button
                variant="outline"
                onClick={() => setMergeDialogOpen(true)}
              >
                <GitMergeIcon className="mr-2 size-4" />
                Merge &amp; Archive
                <KbdShortcut keys={["cmd", "shift", "M"]} />
              </Button>
            )}
          </div>
        </>
      )}

      {!show && canStartRefine && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setShowRefinePrompt((v) => !v)}
            disabled={isRefineDisabled}
          >
            {isRefineDisabled ? (
              <Loader2Icon className="mr-2 size-4 animate-spin" />
            ) : (
              <AGENT_ICONS.plan className="mr-2 size-4" />
            )}
            Refine
          </Button>
        </div>
      )}

      {showRefinePrompt && canStartRefine && (
        <div className="w-full rounded-lg border border-border/50 overflow-hidden">
          <AgentPromptBar
            onSend={() => {}}
            onStop={() => {}}
            status="idle"
            disabled={isRefineDisabled}
            splitSendActions={refineSplitActions}
          />
        </div>
      )}

      {showSessionPrompt && canStartWorkflowSession && onStartWorkflowSession && (
        <div className="w-full rounded-lg border border-border/50 overflow-hidden">
          <AgentPromptBar
            onSend={() => {}}
            onStop={() => {}}
            status="idle"
            disabled={isStartingWorkflowSession}
            splitSendActions={sessionSplitActions}
          />
        </div>
      )}

      {canMerge && (
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
