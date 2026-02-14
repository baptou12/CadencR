import { useState, useRef, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentSession, type AgentSessionHandle } from "@/components/AgentSession";
import { CheckCircle2Icon } from "lucide-react";
import { useFeatureState, type FeatureStatus } from "@/hooks/useFeatureState";
import { PlanSidebar } from "@/components/PlanSidebar";
import { PlanInputView } from "@/components/PlanInputView";
import { NextStepsBar } from "@/components/NextStepsBar";
import { useWorkflowAgents } from "@/hooks/useWorkflowAgents";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";

export function FeatureWorkflowView({
  featureId,
  projectId,
  feature,
  featureQuery,
}: {
  featureId: number;
  projectId: number;
  feature: { id: number; title: string; status: string; type: string; project_id: number; created_at: string } | undefined;
  featureQuery: { refetch: () => unknown };
}) {
  const wf = useWorkflowAgents({ featureId, projectId, featureQuery });

  // --- Inline diff viewer modal state ---
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);

  // --- Keyboard navigation state ---
  const [focusedAgentIndex, setFocusedAgentIndex] = useState<number | null>(null);
  const agentRefs = useRef<Map<number, AgentSessionHandle>>(new Map());

  const setAgentRef = useCallback((index: number, handle: AgentSessionHandle | null) => {
    if (handle) {
      agentRefs.current.set(index, handle);
    } else {
      agentRefs.current.delete(index);
    }
  }, []);

  // CMD+OPT+DOWN: move focus to next agent session
  useHotkeys(
    "meta+alt+down",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      if (wf.sessionEntries.length === 0) return;
      e.preventDefault();
      setFocusedAgentIndex((prev) => {
        if (prev === null) return 0;
        return prev >= wf.sessionEntries.length - 1 ? 0 : prev + 1;
      });
    },
    { enableOnFormTags: true },
  );

  // CMD+OPT+UP: move focus to previous agent session
  useHotkeys(
    "meta+alt+up",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      if (wf.sessionEntries.length === 0) return;
      e.preventDefault();
      setFocusedAgentIndex((prev) => {
        if (prev === null) return wf.sessionEntries.length - 1;
        return prev <= 0 ? wf.sessionEntries.length - 1 : prev - 1;
      });
    },
    { enableOnFormTags: true },
  );

  // Enter: toggle expand/collapse for non-working agents;
  // for working agents, expand and focus prompt bar
  useHotkeys(
    "enter",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      if (focusedAgentIndex === null) return;
      const entry = wf.sessionEntries[focusedAgentIndex];
      if (!entry) return;
      const isWorking = entry.status === "running" || entry.status === "paused";
      const isOpen =
        wf.openAgent === entry.label || isWorking;
      if (isWorking) {
        // Working agent: expand (if needed) and focus prompt bar
        e.preventDefault();
        if (!isOpen) {
          wf.setOpenAgent(entry.label);
        }
        setTimeout(() => {
          agentRefs.current.get(focusedAgentIndex)?.focusPromptBar();
        }, 50);
      } else {
        // Non-working agent: toggle expand/collapse
        e.preventDefault();
        wf.setOpenAgent((prev) =>
          prev === entry.label ? null : entry.label,
        );
      }
    },
    { enableOnFormTags: false },
  );

  // CMD+OPT+Z: leave text input, refocus the parent agent header
  useHotkeys(
    "meta+alt+z",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      e.preventDefault();
      // Blur active element (textarea) to return to agent header focus
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      // Re-focus the main-content zone so CMD+OPT+UP/DOWN still works
      const zone = document.querySelector('[data-focus-zone="main-content"]');
      if (zone instanceof HTMLElement) {
        zone.focus();
      }
    },
    { enableOnFormTags: true },
  );

  // Escape: stop the focused running agent
  useHotkeys(
    "escape",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      if (focusedAgentIndex === null) return;
      const entry = wf.sessionEntries[focusedAgentIndex];
      if (!entry || entry.status !== "running") return;
      e.preventDefault();
      if (entry.type === "execute" && entry.subprocessId) {
        void wf.interruptExecuteSubprocess(entry.subprocessId);
      } else {
        void wf.handleAgentStop(entry.type);
      }
    },
    { enableOnFormTags: true },
  );


  // When focused agent changes, focus its prompt bar (if open) or header (if collapsed)
  // This is handled by the keyboardFocused prop + useEffect would be complex,
  // so we rely on the visual indicator and Enter to expand+focus.

  const { view, actions } = useFeatureState({
    featureStatus: feature?.status as FeatureStatus | undefined,
    plan: { status: wf.plan.status, blocks: wf.plan.blocks },
    brainstorm: { status: wf.brainstorm.status, blocks: wf.brainstorm.blocks },
    execute: { status: wf.execute.status, blocks: wf.execute.blocks },
    risk: { status: wf.risk.status, blocks: wf.risk.blocks },
    review: { status: wf.review.status, blocks: wf.review.blocks },
  });

  // Count how many agents currently have pending questions — disable shortcuts when > 1
  const agentsWithQuestions = wf.sessionEntries.filter(
    (e) => e.pendingQuestions.length > 0,
  ).length;

  return (
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {view === "plan-input" && (
          <PlanInputView
            description={wf.description}
            onDescriptionChange={wf.setDescription}
            onStartPlanning={wf.handleStartPlanning}
            onStartBrainstorming={wf.handleStartBrainstorming}
            isStartingPlan={wf.isStartingPlan}
            isStartingBrainstorm={wf.isStartingBrainstorm}
          />
        )}

        {(wf.hasAnyAgentOutput ||
          actions.canStartBuild ||
          actions.canStartRisk ||
          actions.canStartReview) && (
          <div className="space-y-2">
            {wf.sessionEntries.map((entry, index) => (
              <AgentSession
                key={entry.label}
                ref={(handle) => setAgentRef(index, handle)}
                collapsible
                keyboardFocused={focusedAgentIndex === index}
                agentType={entry.type}
                label={entry.label}
                status={entry.status}
                blocks={entry.blocks}
                open={
                  wf.openAgent === entry.label ||
                  entry.status === "running" ||
                  entry.status === "paused"
                }
                onToggle={() =>
                  wf.setOpenAgent((prev) =>
                    prev === entry.label ? null : entry.label,
                  )
                }
                pendingQuestions={
                  entry.pendingQuestions.length > 0
                    ? entry.pendingQuestions
                    : undefined
                }
                disableShortcuts={agentsWithQuestions > 1}
                onAnswerSubmit={
                  entry.type === "plan"
                    ? wf.handleQuestionResponse
                    : entry.type === "brainstorm"
                      ? wf.handleBrainstormQuestionResponse
                      : entry.type === "execute"
                        ? wf.handleExecuteQuestionResponse
                        : entry.type === "risk"
                          ? wf.handleRiskQuestionResponse
                          : entry.type === "review"
                            ? wf.handleReviewQuestionResponse
                            : undefined
                }
                onSend={(message) => {
                  if (entry.type === "execute" && entry.subprocessId) {
                    wf.sendToExecuteSubprocess(entry.subprocessId, message);
                  } else {
                    wf.handleAgentSend(entry.type, message);
                  }
                }}
                onStop={() => {
                  if (entry.type === "execute" && entry.subprocessId) {
                    void wf.interruptExecuteSubprocess(entry.subprocessId);
                  } else {
                    void wf.handleAgentStop(entry.type);
                  }
                }}
                resumable={entry.resumable}
                onResume={entry.resumable ? () => void wf.handleResume(entry.type, entry.sessionDbId) : undefined}
                // Review verdict props (only effective for review entries)
                reviewComplete={wf.reviewComplete}
                reviewVerdict={wf.reviewVerdict}
                onAddFixPhase={entry.type === "review" ? wf.handleAddFixPhase : undefined}
                onFixImmediately={entry.type === "review" ? wf.handleFixImmediately : undefined}
                isAddingFixPhase={wf.isAddingFixPhase}
                isStartingFix={wf.isStartingFix}
                hasFileChanges={entry.hasFileChanges}
                onViewDiff={handleViewDiff}
              />
            ))}

            <NextStepsBar
              show={
                wf.noAgentsRunning &&
                (actions.canStartBuild ||
                  actions.canStartRisk ||
                  actions.canStartReview ||
                  wf.canContinueBuild)
              }
              canStartBuild={actions.canStartBuild}
              canStartRisk={actions.canStartRisk}
              canStartReview={actions.canStartReview}
              executeStatus={wf.execute.status}
              onStartBuilding={wf.handleStartBuilding}
              onStartRisk={wf.handleStartRisk}
              onStartReview={wf.handleStartReview}
              isStartingExecute={wf.isStartingExecute}
              isStartingRisk={wf.isStartingRisk}
              isStartingReview={wf.isStartingReview}
              canContinueBuild={wf.canContinueBuild}
              onContinueBuild={wf.handleContinueBuild}
              isContinuingBuild={wf.isContinuingBuild}
              nextStepNumber={wf.executeWaitingNextStep}
            />

            {view === "done" && (
              <div className="flex items-center gap-3 pt-4">
                <CheckCircle2Icon className="size-8 text-green-600" />
                <div>
                  <h2 className="text-lg font-semibold">Feature Complete</h2>
                  <p className="text-sm text-muted-foreground">
                    This feature has been reviewed and marked as done.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {view === "done" && !wf.hasAnyAgentOutput && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2Icon className="size-8 text-green-600" />
              <div>
                <h2 className="text-lg font-semibold">Feature Complete</h2>
                <p className="text-sm text-muted-foreground">
                  This feature has been reviewed and marked as done.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
        <PlanSidebar featureId={featureId} />
      </div>

      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
      />
    </div>
  );
}
