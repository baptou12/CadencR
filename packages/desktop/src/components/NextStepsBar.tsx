import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2Icon, GitMergeIcon } from "lucide-react";
import type { AgentStatus } from "@/types/agent";
import { AGENT_ICONS } from "@/components/agent-icons";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { MergeArchiveDialog } from "@/components/MergeArchiveDialog";
import type { SplitSendAction, AgentPromptBarHandle } from "@/components/AgentPromptBar";
import { PromptWithModelPicker } from "@/components/PromptWithModelPicker";
import { useEnabledOptInModes } from "@/hooks/useEnabledOptInModes";
import { nextProviderMode, defaultEditModeFor } from "@/lib/provider-modes";
import type { PermissionMode } from "@/types/permission-mode";

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
  onStartWorkflowSession?: (
    prompt: string,
    images?: Array<{ base64: string; mimeType: string }>,
    permissionMode?: PermissionMode,
  ) => void;
  isStartingWorkflowSession?: boolean;
  noExecuteAgentRunning?: boolean;
  projectId?: number;
  featureId?: number;
  featureType?: string;
  sessionProviderId: string;
  canStartRefine?: boolean;
  onStartRefinePlan?: (
    description: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ) => void;
  isStartingRefinePlan?: boolean;
  openSessionPrompt?: number;
  canStartRetro?: boolean;
  onStartRetro?: () => void;
  isStartingRetro?: boolean;
  /** Forwarded to the inner prompt bars — gates agent-menu shortcuts on agent tab visibility. */
  agentTabActive?: boolean;
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
  noExecuteAgentRunning,
  projectId,
  featureId,
  featureType,
  sessionProviderId,
  canStartRefine,
  onStartRefinePlan,
  isStartingRefinePlan,
  openSessionPrompt,
  canStartRetro,
  onStartRetro,
  isStartingRetro,
  agentTabActive,
}: NextStepsBarProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [showRefinePrompt, setShowRefinePrompt] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [sessionPermissionMode, setSessionPermissionMode] = useState<PermissionMode>("acceptEdits");
  const sessionPromptRef = useRef<AgentPromptBarHandle>(null);
  const enabledOptInModes = useEnabledOptInModes(sessionProviderId);

  const canMerge =
    noExecuteAgentRunning &&
    (featureType === "feature" || featureType === "ws-feature") &&
    projectId != null &&
    featureId != null;

  const isRefineDisabled = !!isStartingRefinePlan;

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

  useEffect(() => {
    setSessionPermissionMode(defaultEditModeFor(sessionProviderId));
  }, [sessionProviderId]);

  // Open session prompt when triggered externally (e.g. keyboard shortcut)
  useEffect(() => {
    if (openSessionPrompt && openSessionPrompt > 0) {
      setShowSessionPrompt(true);
    }
  }, [openSessionPrompt]);

  // Auto-focus session prompt when it opens
  useEffect(() => {
    if (showSessionPrompt) {
      requestAnimationFrame(() => sessionPromptRef.current?.focusInput());
    }
  }, [showSessionPrompt]);

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
          setShowRefinePrompt(false);
          onStartRefinePlan?.(text, images);
        },
      },
    ],
    [isStartingRefinePlan, onStartRefinePlan],
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
          setShowSessionPrompt(false);
          onStartWorkflowSession?.(text, images, sessionPermissionMode);
        },
      },
    ],
    [isStartingWorkflowSession, onStartWorkflowSession, sessionPermissionMode],
  );

  const handleSessionPermissionModeToggle = (): void => {
    setSessionPermissionMode((current) =>
      nextProviderMode(sessionProviderId, current, enabledOptInModes),
    );
  };

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
              <ShortcutTooltip
                label={
                  nextStepNumber != null
                    ? `Continue to Step ${nextStepNumber}`
                    : "Continue Building"
                }
                keys={["cmd", "shift", "B"]}
                above
              >
                <Button onClick={onContinueBuild} disabled={isContinuingBuild}>
                  {isContinuingBuild ? (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <AGENT_ICONS.execute className="mr-2 size-4" />
                  )}
                  {nextStepNumber != null
                    ? `Continue to Step ${nextStepNumber}`
                    : "Continue Building"}
                </Button>
              </ShortcutTooltip>
            )}
            {canStartBuild && !canContinueBuild && (
              <ShortcutTooltip
                label={executeStatus === "error" ? "Retry Build" : "Start Building"}
                keys={["cmd", "shift", "B"]}
                above
              >
                <Button onClick={onStartBuilding} disabled={isStartingExecute}>
                  {isStartingExecute ? (
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <AGENT_ICONS.execute className="mr-2 size-4" />
                  )}
                  {executeStatus === "error" ? "Retry Build" : "Start Building"}
                </Button>
              </ShortcutTooltip>
            )}
            {canStartWorkflowSession && onStartWorkflowSession && (
              <ShortcutTooltip label="Start Session" keys={["cmd", "shift", "S"]} above>
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
                </Button>
              </ShortcutTooltip>
            )}
            {canStartRisk && (
              <Button variant="outline" onClick={onStartRisk} disabled={isStartingRisk}>
                {isStartingRisk ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <AGENT_ICONS.risk className="mr-2 size-4" />
                )}
                Evaluate Risk
              </Button>
            )}
            {canStartReview && (
              <Button variant="outline" onClick={onStartReview} disabled={isStartingReview}>
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
              <ShortcutTooltip label="Merge & Archive" keys={["cmd", "shift", "M"]} above>
                <Button variant="outline" onClick={() => setMergeDialogOpen(true)}>
                  <GitMergeIcon className="mr-2 size-4" />
                  Merge &amp; Archive
                </Button>
              </ShortcutTooltip>
            )}
            {canStartRetro && (
              <Button variant="outline" onClick={onStartRetro} disabled={isStartingRetro}>
                {isStartingRetro ? (
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                ) : (
                  <AGENT_ICONS.retro className="mr-2 size-4" />
                )}
                Run Retrospective
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

      {showRefinePrompt && canStartRefine && featureId != null && projectId != null && (
        <PromptWithModelPicker
          featureId={featureId}
          projectId={projectId}
          agentType="plan"
          disabled={isRefineDisabled}
          splitSendActions={refineSplitActions}
          agentTabActive={agentTabActive}
        />
      )}

      {showSessionPrompt &&
        canStartWorkflowSession &&
        onStartWorkflowSession &&
        featureId != null &&
        projectId != null && (
          <PromptWithModelPicker
            featureId={featureId}
            projectId={projectId}
            agentType="session"
            permissionMode={sessionPermissionMode}
            onPermissionModeToggle={handleSessionPermissionModeToggle}
            enabledOptInModes={enabledOptInModes}
            disabled={isStartingWorkflowSession}
            splitSendActions={sessionSplitActions}
            promptBarRef={sessionPromptRef}
            agentTabActive={agentTabActive}
          />
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
