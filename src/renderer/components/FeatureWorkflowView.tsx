import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useHotkeys } from "react-hotkeys-hook";
import { trpc } from "@/trpc";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { AgentSession, AGENT_LABELS, type AgentSessionHandle } from "@/components/AgentSession";
import { CheckCircle2Icon } from "lucide-react";
import { useFeatureState, type FeatureStatus } from "@/hooks/useFeatureState";
import { PlanSidebar } from "@/components/PlanSidebar";
import { PlanInputView } from "@/components/PlanInputView";
import { NextStepsBar } from "@/components/NextStepsBar";
import { useWorkflowAgents } from "@/hooks/useWorkflowAgents";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { DiffViewerModal, type ExecuteAgentState } from "@/components/diff/DiffViewerModal";
import { WorktreeSetupSection } from "@/components/WorktreeSetupSection";
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useTerminalState } from "@/hooks/useTerminalState";

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
  const contextUsageMap = useContextUsage(featureId, wf.sessionEntries);
  const utils = trpc.useUtils();

  // --- Model settings for inline model switcher ---
  const { resolveModel, handleModelChange } = useResolvedModel(featureId, projectId);

  const submitToolPermissionMutation = trpc.agents.submitToolPermission.useMutation();

  const handlePermissionDecision = useCallback(
    (entry: FeatureSession, decision: "allow_once" | "allow_future" | "deny", feedback?: string) => {
      if (!entry.subprocessId) return;
      submitToolPermissionMutation.mutate({
        subprocessId: entry.subprocessId,
        decision,
        feedback,
      });
    },
    [submitToolPermissionMutation],
  );

  const deleteSession = trpc.agents.deleteSession.useMutation({
    onSuccess: () => {
      utils.agents.getFeatureAgentState.invalidate({ featureId });
    },
  });

  const handleDeleteAgent = useCallback((entry: FeatureSession) => {
    if (!entry.sessionDbId) return;
    const label = AGENT_LABELS[entry.agentType] ?? entry.agentType;
    if (confirm(`Remove "${label}" agent? This will delete its messages.`)) {
      deleteSession.mutate({ sessionId: entry.sessionDbId });
    }
  }, [deleteSession]);

  // --- Maximized agent state ---
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null);

  // --- Plan approval (for MCP show_plan) ---
  const submitPlanApprovalMutation = trpc.agents.submitPlanApproval.useMutation();

  // --- Inline diff viewer modal state ---
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiff = useCallback(() => setInlineDiffOpen(true), []);

  // Derive execute agent state for the diff viewer modal
  const executeState: ExecuteAgentState | undefined = useMemo(() => {
    const execEntry = wf.sessionEntries.find(
      (e) => e.agentType === "execute" && e.subprocessId && (e.status === "running" || e.status === "paused"),
    );
    if (!execEntry?.subprocessId) return undefined;
    return {
      subprocessId: execEntry.subprocessId,
      status: execEntry.status,
      pendingQuestions: execEntry.pendingQuestions,
    };
  }, [wf.sessionEntries]);

  // --- Keyboard navigation (DOM-based focus) ---
  const agentRefs = useRef<Map<number, AgentSessionHandle>>(new Map());

  const setAgentRef = useCallback((index: number, handle: AgentSessionHandle | null) => {
    if (handle) {
      agentRefs.current.set(index, handle);
    } else {
      agentRefs.current.delete(index);
    }
  }, []);

  const moveFocus = useCallback((direction: "up" | "down") => {
    const count = wf.sessionEntries.length;
    if (count === 0) return;

    // Find which agent currently contains focus by walking up the DOM
    let currentAgentIndex = -1;
    let el: HTMLElement | null = document.activeElement as HTMLElement | null;
    while (el) {
      const containerAttr = el.getAttribute("data-agent-container");
      if (containerAttr != null) {
        currentAgentIndex = Number(containerAttr);
        break;
      }
      el = el.parentElement;
    }

    let nextIndex: number;
    if (currentAgentIndex === -1) {
      nextIndex = direction === "down" ? 0 : count - 1;
    } else if (direction === "down") {
      nextIndex = currentAgentIndex >= count - 1 ? 0 : currentAgentIndex + 1;
    } else {
      nextIndex = currentAgentIndex <= 0 ? count - 1 : currentAgentIndex - 1;
    }

    agentRefs.current.get(nextIndex)?.focusActiveInput();
  }, [wf.sessionEntries]);

  // CMD+OPT+DOWN: move focus to next agent session
  useHotkeys(
    "meta+alt+down",
    (e) => {
      const zone = getActiveFocusZone();
      if (zone && zone !== "main-content") return;
      e.preventDefault();
      moveFocus("down");
    },
    { enableOnFormTags: true },
  );

  // CMD+OPT+UP: move focus to previous agent session
  useHotkeys(
    "meta+alt+up",
    (e) => {
      const zone = getActiveFocusZone();
      if (zone && zone !== "main-content") return;
      e.preventDefault();
      moveFocus("up");
    },
    { enableOnFormTags: true },
  );

  // Enter: toggle expand/collapse for non-working agents;
  // for working agents, expand and focus prompt bar
  useHotkeys(
    "enter",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.hasAttribute("data-nav-item")) return;
      const agentIndexStr = focused.getAttribute("data-nav-agent-index");
      if (agentIndexStr == null) return;
      const agentIndex = Number(agentIndexStr);
      const entry = wf.sessionEntries[agentIndex];
      if (!entry) return;
      const sessionKey = `${entry.agentType}-${entry.sessionDbId}`;
      const isWorking = entry.status === "running" || entry.status === "paused";
      const isOpen =
        wf.openAgent === sessionKey || isWorking;
      if (isWorking) {
        e.preventDefault();
        if (!isOpen) {
          wf.setOpenAgent(sessionKey);
        }
        requestAnimationFrame(() => {
          agentRefs.current.get(agentIndex)?.focusActiveInput();
        });
      } else {
        e.preventDefault();
        wf.setOpenAgent((prev) =>
          prev === sessionKey ? null : sessionKey,
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
      // Re-focus the main-content zone so onFocus delegation picks the first nav item
      const zone = document.querySelector('[data-focus-zone="main-content"]');
      if (zone instanceof HTMLElement) {
        zone.focus();
      }
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+B: start or continue building
  useHotkeys(
    "meta+shift+b",
    (e) => {
      if (wf.canContinueBuild && wf.handleContinueBuild && !wf.isContinuingBuild) {
        e.preventDefault();
        wf.handleContinueBuild();
      } else if (actions.canStartBuild && !wf.canContinueBuild && !wf.isStartingExecute) {
        e.preventDefault();
        wf.handleStartBuilding();
      }
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+S: start a workflow session agent
  useHotkeys(
    "meta+shift+s",
    (e) => {
      if (!actions.canStartWorkflowSession || wf.isStartingWorkflowSession) return;
      e.preventDefault();
      wf.handleStartWorkflowSession();
    },
    { enableOnFormTags: true },
  );

  // Escape: stop the focused running agent
  useHotkeys(
    "escape",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.hasAttribute("data-nav-item")) return;
      const agentIndexStr = focused.getAttribute("data-nav-agent-index");
      if (agentIndexStr == null) return;
      const agentIndex = Number(agentIndexStr);
      const entry = wf.sessionEntries[agentIndex];
      if (!entry || entry.status !== "running") return;
      e.preventDefault();
      if (entry.agentType === "execute" && entry.subprocessId) {
        void wf.interruptExecuteSubprocess(entry.subprocessId);
      } else {
        void wf.handleAgentStop(entry.agentType);
      }
    },
    { enableOnFormTags: true },
  );

  const { view, actions } = useFeatureState({
    featureStatus: feature?.status as FeatureStatus | undefined,
    plan: { status: wf.plan.status, blocks: wf.plan.blocks },
    brainstorm: { status: wf.brainstorm.status, blocks: wf.brainstorm.blocks },
    execute: { status: wf.execute.status, blocks: wf.execute.blocks },
    risk: { status: wf.risk.status, blocks: wf.risk.blocks },
    review: { status: wf.review.status, blocks: wf.review.blocks },
  });

  // Auto-focus the prompt bar of a newly started agent
  const prevRunningAgentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentRunning = new Set(
      wf.sessionEntries
        .filter((e) => e.status === "running" || e.status === "paused")
        .map((e) => `${e.agentType}-${e.sessionDbId}`),
    );
    // Find agents that just became running/paused
    for (const key of currentRunning) {
      if (!prevRunningAgentsRef.current.has(key)) {
        const index = wf.sessionEntries.findIndex(
          (e) => `${e.agentType}-${e.sessionDbId}` === key,
        );
        if (index >= 0) {
          requestAnimationFrame(() => {
            agentRefs.current.get(index)?.focusPromptBar();
          });
        }
        break; // focus only the first new one
      }
    }
    prevRunningAgentsRef.current = currentRunning;
  }, [wf.sessionEntries]);

  // Count how many agents currently have pending questions — disable shortcuts when > 1
  const agentsWithQuestions = wf.sessionEntries.filter(
    (e) => e.pendingQuestions && e.pendingQuestions.length > 0,
  ).length;

  // Terminal panel state
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const terminalState = useTerminalState(featureId);
  const terminalHeightSetting = useDebouncedSetting("terminal_panel_height_px");
  const [terminalHeightPx, setTerminalHeightPx] = useState(300);

  // Sync height from DB when setting loads
  useEffect(() => {
    const saved = Number(terminalHeightSetting.value);
    if (saved > 0) setTerminalHeightPx(saved);
  }, [terminalHeightSetting.value]);

  const handleTerminalToolbarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeightPx;
    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.round(Math.max(80, Math.min(window.innerHeight * 0.8, startHeight + delta)));
      setTerminalHeightPx(newHeight);
      terminalHeightSetting.setValue(String(newHeight));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [terminalHeightPx, terminalHeightSetting]);

  /** Focus the last active agent's prompt (used when terminal collapses) */
  const focusLastAgentPrompt = useCallback(() => {
    requestAnimationFrame(() => {
      // Try to focus the last running/paused agent, otherwise the last agent
      const entries = wf.sessionEntries;
      const activeIndex = entries.findLastIndex((e) => e.status === "running" || e.status === "paused");
      const targetIndex = activeIndex >= 0 ? activeIndex : entries.length - 1;
      if (targetIndex >= 0) {
        agentRefs.current.get(targetIndex)?.focusActiveInput();
      }
    });
  }, [wf.sessionEntries]);

  // Ctrl+` — toggle terminal panel
  useHotkeys(
    "ctrl+backquote",
    (e) => {
      e.preventDefault();
      const wasOpen = terminalState.isOpen && !terminalState.isMinimized;
      terminalState.togglePanel();
      if (wasOpen) {
        focusLastAgentPrompt();
      } else {
        requestAnimationFrame(() => terminalRef.current?.focusActivePane());
      }
    },
    { enableOnFormTags: true },
  );

  // Ctrl+Shift+` — add a new split pane (only when panel is open)
  useHotkeys(
    "ctrl+shift+backquote",
    (e) => {
      if (!terminalState.isOpen || terminalState.isMinimized) return;
      e.preventDefault();
      terminalState.addPane();
    },
    { enableOnFormTags: true },
  );

  return (
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 overflow-hidden">
        <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
            {view === "plan-input" && (
              <div className="shrink-0 overflow-auto p-6">
                <PlanInputView
                  description={wf.description}
                  onDescriptionChange={wf.setDescription}
                  onStartPlanning={wf.handleStartPlanning}
                  onStartBrainstorming={wf.handleStartBrainstorming}
                  isStartingPlan={wf.isStartingPlan}
                  isStartingBrainstorm={wf.isStartingBrainstorm}
                />
              </div>
            )}

            {view !== "plan-input" && !maximizedAgent && (
              <div className="shrink-0 px-6 pt-6">
                <WorktreeSetupSection featureId={featureId} projectId={projectId} />
              </div>
            )}

            {(wf.hasAnyAgentOutput ||
              actions.canStartBuild ||
              actions.canStartRisk ||
              actions.canStartReview) && (
              <div className="flex flex-col gap-2 flex-1 min-h-0 px-6 py-2">
                {(() => {
                  const activeEntries = wf.sessionEntries.filter(
                    (e) => e.status === "running" || e.status === "paused",
                  );
                  const inactiveEntries = wf.sessionEntries.filter(
                    (e) => e.status !== "running" && e.status !== "paused",
                  );
                  const activeCount = activeEntries.length;
                  const useGrid = !maximizedAgent && activeCount > 1;

                  const renderAgent = (entry: FeatureSession, index: number, isGridItem: boolean) => {
                  const label = entry.agentType === "execute" && entry.phaseTitle
                    ? `Execute - ${entry.phaseTitle}`
                    : AGENT_LABELS[entry.agentType] ?? entry.agentType;
                  const sessionKey = `${entry.agentType}-${entry.sessionDbId}`;
                  const questions = entry.pendingQuestions ?? [];
                  const isThisMaximized = maximizedAgent === sessionKey;
                  // Hide non-maximized agents when another is maximized
                  if (maximizedAgent && !isThisMaximized) return null;
                  return (
                    <AgentSession
                      key={sessionKey}
                      ref={(handle) => setAgentRef(index, handle)}
                      collapsible
                      navAgentIndex={index}
                      agentType={entry.agentType}
                      label={label}
                      status={entry.status}
                      blocks={entry.blocks}
                      open={
                        wf.openAgent === sessionKey ||
                        entry.status === "running" ||
                        entry.status === "paused"
                      }
                      onToggle={() =>
                        wf.setOpenAgent((prev) =>
                          prev === sessionKey ? null : sessionKey,
                        )
                      }
                      maximized={isThisMaximized}
                      onToggleMaximize={() =>
                        setMaximizedAgent((prev) =>
                          prev === sessionKey ? null : sessionKey,
                        )
                      }
                      pendingQuestions={
                        questions.length > 0 ? questions : undefined
                      }
                      disableShortcuts={agentsWithQuestions > 1}
                      onMarkDone={entry.agentType === "session" && (entry.status === "running" || entry.status === "paused")
                        ? () => wf.handleMarkSessionDone(entry.sessionDbId)
                        : undefined
                      }
                      onAnswerSubmit={
                        entry.agentType === "plan"
                          ? wf.handleQuestionResponse
                          : entry.agentType === "brainstorm"
                            ? wf.handleBrainstormQuestionResponse
                            : entry.agentType === "execute"
                              ? wf.handleExecuteQuestionResponse
                              : entry.agentType === "risk"
                                ? wf.handleRiskQuestionResponse
                                : entry.agentType === "review"
                                  ? wf.handleReviewQuestionResponse
                                  : undefined
                      }
                      onSend={(message) => {
                        if (entry.agentType === "execute" && entry.subprocessId) {
                          wf.sendToExecuteSubprocess(entry.subprocessId, message);
                        } else {
                          wf.handleAgentSend(entry.agentType, message);
                        }
                      }}
                      onStop={() => {
                        if (entry.agentType === "execute" && entry.subprocessId) {
                          void wf.interruptExecuteSubprocess(entry.subprocessId);
                        } else {
                          void wf.handleAgentStop(entry.agentType);
                        }
                      }}
                      resumable={entry.resumable}
                      onResume={entry.resumable ? () => void wf.handleResume(entry.agentType, entry.sessionDbId) : undefined}
                      reviewComplete={wf.reviewComplete}
                      reviewVerdict={wf.reviewVerdict}
                      onAddFixPhase={entry.agentType === "review" ? wf.handleAddFixPhase : undefined}
                      onFixImmediately={entry.agentType === "review" ? wf.handleFixImmediately : undefined}
                      isAddingFixPhase={wf.isAddingFixPhase}
                      isStartingFix={wf.isStartingFix}
                      hasFileChanges={entry.hasFileChanges}
                      onViewDiff={handleViewDiff}
                      todos={entry.todos}
                      currentModelId={resolveModel(entry.agentType)}
                      onModelChange={(modelId) => handleModelChange(entry.agentType, modelId)}
                      canDelete={entry.status !== "running" && entry.status !== "completed" && !!entry.sessionDbId}
                      onDelete={() => handleDeleteAgent(entry)}
                      contextUsage={contextUsageMap.get(entry.sessionDbId)}
                      featureId={featureId}
                      projectId={projectId}
                      subprocessId={entry.subprocessId ?? undefined}
                      pendingPermission={entry.pendingPermission}
                      onPermissionDecision={(decision, feedback) => handlePermissionDecision(entry, decision, feedback)}
                      pendingPlanApproval={entry.pendingPlanApproval}
                      planApproveLabel="Approve"
                      onPlanApprove={entry.subprocessId ? () => submitPlanApprovalMutation.mutate({ subprocessId: entry.subprocessId!, approved: true }) : undefined}
                      onPlanRequestChanges={entry.subprocessId ? (feedback: string) => submitPlanApprovalMutation.mutate({ subprocessId: entry.subprocessId!, approved: false, feedback }) : undefined}
                      className={isGridItem ? "min-h-0 h-full overflow-hidden" : undefined}
                    />
                  );
                  };

                  return (
                    <>
                      {/* Inactive agents: vertical stack */}
                      {inactiveEntries.map((entry) => {
                        const idx = wf.sessionEntries.indexOf(entry);
                        return renderAgent(entry, idx, false);
                      })}

                      {/* Active agents: grid when multiple, vertical when single */}
                      {activeCount > 0 && (
                        <div className={cn(
                          "flex-1 min-h-0 gap-2",
                          useGrid
                            ? "grid overflow-auto auto-rows-[minmax(300px,1fr)]"
                            : "flex flex-col",
                          useGrid && activeCount === 2 && "grid-cols-2",
                          useGrid && activeCount >= 3 && "grid-cols-3",
                        )}>
                          {activeEntries.map((entry) => {
                            const idx = wf.sessionEntries.indexOf(entry);
                            return renderAgent(entry, idx, useGrid);
                          })}
                        </div>
                      )}

                    </>
                  );
                })()}

                {!maximizedAgent && (
                  <div className="shrink-0">
                    <NextStepsBar
                      show={
                        wf.noAgentsRunning &&
                        (actions.canStartBuild ||
                          actions.canStartRisk ||
                          actions.canStartReview ||
                          actions.canStartWorkflowSession ||
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
                      canStartWorkflowSession={actions.canStartWorkflowSession}
                      onStartWorkflowSession={wf.handleStartWorkflowSession}
                      isStartingWorkflowSession={wf.isStartingWorkflowSession}
                    />
                  </div>
                )}

                {!maximizedAgent && view === "done" && (
                  <div className="shrink-0 flex items-center gap-3 pt-4">
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
              <div className="mx-auto max-w-2xl space-y-4 p-6">
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
        {terminalState.panes.length > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 border-t border-[#292e42] transition-transform duration-150 ease-in-out"
            style={{
              height: terminalState.isMinimized ? 32 : terminalHeightPx,
              transform: terminalState.isOpen ? "translateY(0)" : "translateY(100%)",
            }}
          >
            <TerminalPanel
              ref={terminalRef}
              featureId={featureId}
              projectId={projectId}
              state={terminalState}
              togglePanel={terminalState.togglePanel}
              addPane={terminalState.addPane}
              removePane={terminalState.removePane}
              minimize={terminalState.minimize}
              onToolbarMouseDown={handleTerminalToolbarMouseDown}
              onCollapse={focusLastAgentPrompt}
            />
          </div>
        )}
      </div>

      <DiffViewerModal
        featureId={featureId}
        open={inlineDiffOpen}
        onOpenChange={setInlineDiffOpen}
        executeState={executeState}
      />
    </div>
  );
}
