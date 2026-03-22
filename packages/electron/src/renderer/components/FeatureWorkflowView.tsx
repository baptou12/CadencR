import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useGetFeaturePrd } from "@/api/generated";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import {
  AgentSession,
  AGENT_LABELS,
  type AgentSessionHandle,
} from "@/components/AgentSession";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";
import { Button } from "@/components/ui/button";
import { QueueSidebar } from "@/components/QueueSidebar";
import { PlanInputView } from "@/components/PlanInputView";
import { NextStepsBar } from "@/components/NextStepsBar";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { DiffViewerModal } from "@/components/diff/DiffViewerModal";
import { WorktreeSetupSection } from "@/components/WorktreeSetupSection";
import {
  TerminalPanel,
  type TerminalPanelHandle,
} from "@/components/terminal/TerminalPanel";
import type { FeatureSession } from "@/hooks/useFeatureAgentState";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { useTerminalState, useTerminalStore } from "@/hooks/useTerminalState";
import { CodeBlockActionsContext, type CodeBlockActions } from "@/components/CodeBlockActionsContext";
import { cn } from "@/lib/utils";
import { useWorkflowBackend } from "@/hooks/useWorkflowBackend";

export function FeatureWorkflowView({
  featureId,
  projectId,
  feature,
  featureQuery: _featureQuery,
}: {
  featureId: number;
  projectId: number;
  feature:
    | {
        id: number;
        title: string;
        status: string;
        type: string;
        project_id: number;
        created_at: string;
      }
    | undefined;
  featureQuery: { refetch: () => unknown };
}) {
  // UI state
  const [description, setDescription] = useState("");
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const [openAgent, setOpenAgent] = useState<string | null>(null);

  const { data: prdData } = useGetFeaturePrd(featureId);

  // ---- Unified backend ----
  const backend = useWorkflowBackend(
    featureId,
    projectId,
    feature?.type ?? "feature",
  );

  const contextUsageMap = useContextUsage(featureId, backend.sessionEntries);

  // --- Model settings for inline model switcher ---
  const { resolveModel, handleModelChange } = useResolvedModel(
    featureId,
    projectId,
  );

  const handleDeleteAgent = useCallback(
    (entry: FeatureSession) => {
      if (!entry.sessionDbId) return;
      const label = AGENT_LABELS[entry.agentType] ?? entry.agentType;
      if (confirm(`Remove "${label}" agent? This will delete its messages.`)) {
        backend.deleteSession(entry.sessionDbId);
      }
    },
    [backend],
  );

  // --- Maximized agent state ---
  const [maximizedAgent, setMaximizedAgent] = useState<string | null>(null);

  // Auto-clear maximize when the maximized agent finishes
  useEffect(() => {
    if (!maximizedAgent) return;
    const entry = backend.sessionEntries.find((e) => {
      const key = `${e.agentType}-${e.sessionDbId}`;
      return key === maximizedAgent;
    });
    if (entry && entry.status !== "running" && entry.status !== "paused") {
      setMaximizedAgent(null);
    }
  }, [maximizedAgent, backend.sessionEntries]);

  // --- Inline diff viewer modal state ---
  const [inlineDiffOpen, setInlineDiffOpen] = useState(false);
  const handleViewDiffForAgent = useCallback(() => {
    setInlineDiffOpen(true);
  }, []);

  // --- Keyboard navigation (DOM-based focus) ---
  const agentRefs = useRef<Map<number, AgentSessionHandle>>(new Map());

  const setAgentRef = useCallback(
    (index: number, handle: AgentSessionHandle | null) => {
      if (handle) {
        agentRefs.current.set(index, handle);
      } else {
        agentRefs.current.delete(index);
      }
    },
    [],
  );

  const moveFocus = useCallback(
    (direction: "up" | "down") => {
      const count = backend.sessionEntries.length;
      if (count === 0) return;

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
    },
    [backend.sessionEntries],
  );

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

  useHotkeys(
    "enter",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.hasAttribute("data-nav-item")) return;
      const agentIndexStr = focused.getAttribute("data-nav-agent-index");
      if (agentIndexStr == null) return;
      const agentIndex = Number(agentIndexStr);
      const entry = backend.sessionEntries[agentIndex];
      if (!entry) return;
      const sessionKey = `${entry.agentType}-${entry.sessionDbId}`;
      const isWorking = entry.status === "running" || entry.status === "paused";
      const isOpen = openAgent === sessionKey || isWorking;
      if (isWorking) {
        e.preventDefault();
        if (!isOpen) {
          setOpenAgent(sessionKey);
        }
        requestAnimationFrame(() => {
          agentRefs.current.get(agentIndex)?.focusActiveInput();
        });
      } else {
        e.preventDefault();
        setOpenAgent((prev) => (prev === sessionKey ? null : sessionKey));
      }
    },
    { enableOnFormTags: false },
  );

  useHotkeys(
    "meta+alt+z",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      e.preventDefault();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
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
      if (
        backend.canContinueBuild &&
        !backend.isContinuingBuild
      ) {
        e.preventDefault();
        backend.continueWorkflow();
      } else if (
        backend.actions.canStartBuild &&
        !backend.canContinueBuild &&
        !backend.isStartingExecute
      ) {
        e.preventDefault();
        backend.startBuilding();
      }
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+S: open session prompt bar
  const [sessionPromptTrigger, setSessionPromptTrigger] = useState(0);
  useHotkeys(
    "meta+shift+s",
    (e) => {
      if (!backend.actions.canStartWorkflowSession || backend.isStartingWorkflowSession)
        return;
      e.preventDefault();
      setSessionPromptTrigger((v) => v + 1);
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
      const entry = backend.sessionEntries[agentIndex];
      if (!entry || entry.status !== "running") return;
      e.preventDefault();
      if (entry.agentType === "execute" && entry.subprocessId) {
        backend.interruptAgent(entry);
      } else {
        backend.stopAgent(entry);
      }
    },
    { enableOnFormTags: true },
  );

  // Use backend.view instead of useFeatureState
  const view = backend.view;
  const actions = backend.actions;

  // Auto-focus the prompt bar of a newly started agent
  const prevRunningAgentsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentRunning = new Set(
      backend.sessionEntries
        .filter((e) => e.status === "running" || e.status === "paused")
        .map((e) => `${e.agentType}-${e.sessionDbId}`),
    );
    for (const key of currentRunning) {
      if (!prevRunningAgentsRef.current.has(key)) {
        const index = backend.sessionEntries.findIndex(
          (e) => `${e.agentType}-${e.sessionDbId}` === key,
        );
        if (index >= 0) {
          requestAnimationFrame(() => {
            agentRefs.current.get(index)?.focusPromptBar();
          });
        }
        break;
      }
    }
    prevRunningAgentsRef.current = currentRunning;
  }, [backend.sessionEntries]);

  const agentsWithQuestions = backend.sessionEntries.filter(
    (e) => e.pendingQuestions && e.pendingQuestions.length > 0,
  ).length;

  // Terminal panel state
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const terminalState = useTerminalState(featureId);
  const sendToTerminalStore = useTerminalStore((s) => s.sendToTerminal);
  const codeBlockActions = useMemo<CodeBlockActions>(
    () => ({ sendToTerminal: (cmd) => sendToTerminalStore(featureId, cmd) }),
    [sendToTerminalStore, featureId],
  );
  const terminalHeightSetting = useDebouncedSetting("terminal_panel_height_px");
  const [terminalHeightPx, setTerminalHeightPx] = useState(300);

  useEffect(() => {
    const saved = Number(terminalHeightSetting.value);
    if (saved > 0) setTerminalHeightPx(saved);
  }, [terminalHeightSetting.value]);

  // Auto-load conversation history for agents that are already open (paused/running)
  // but have empty blocks — e.g. after app restart. The batched loadAgentHistory
  // makes a single API call and distributes blocks to all agents, so we only need
  // to trigger it once. We key on sessionCount so it fires after hydration.
  const sessionCount = backend.sessionEntries.length;
  const { loadAgentHistory } = backend;
  useEffect(() => {
    if (!loadAgentHistory || sessionCount === 0) return;
    for (const entry of backend.sessionEntries) {
      if (
        (entry.status === "paused" || entry.status === "running") &&
        entry.blocks.length === 0
      ) {
        loadAgentHistory(entry);
        break; // single API call distributes blocks to all agents
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally key on count, not entries array
  }, [sessionCount, loadAgentHistory, featureId]);

  const handleTerminalToolbarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = terminalHeightPx;
      const onMouseMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        const newHeight = Math.round(
          Math.max(80, Math.min(window.innerHeight * 0.8, startHeight + delta)),
        );
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
    },
    [terminalHeightPx, terminalHeightSetting],
  );

  const focusLastAgentPrompt = useCallback(() => {
    requestAnimationFrame(() => {
      const entries = backend.sessionEntries;
      const activeIndex = entries.findLastIndex(
        (e) => e.status === "running" || e.status === "paused",
      );
      const targetIndex = activeIndex >= 0 ? activeIndex : entries.length - 1;
      if (targetIndex >= 0) {
        agentRefs.current.get(targetIndex)?.focusActiveInput();
      }
    });
  }, [backend.sessionEntries]);

  const getFocusedEntry = useCallback((): FeatureSession | null => {
    let el: HTMLElement | null = document.activeElement as HTMLElement | null;
    while (el) {
      const attr = el.getAttribute("data-agent-container");
      if (attr != null) {
        const idx = Number(attr);
        return backend.sessionEntries[idx] ?? null;
      }
      el = el.parentElement;
    }
    return null;
  }, [backend.sessionEntries]);

  useHotkeys(
    "meta+d",
    (e) => {
      e.preventDefault();
      const entry = getFocusedEntry();
      if (!entry) return;
      handleViewDiffForAgent(entry);
    },
    { enableOnFormTags: true },
  );

  useHotkeys(
    "meta+m",
    (e) => {
      e.preventDefault();
      const entry = getFocusedEntry();
      if (!entry) return;
      if (entry.agentType !== "session" && entry.agentType !== "review-fixer")
        return;
      if (entry.status !== "running" && entry.status !== "paused") return;
      backend.markDone(entry.sessionDbId);
    },
    { enableOnFormTags: true },
  );

  useHotkeys(
    "meta+1",
    (e) => {
      e.preventDefault();
      const entry = getFocusedEntry();
      if (!entry || !entry.pendingPlanApproval || !entry.subprocessId) return;
      backend.approvePlan(entry.subprocessId);
    },
    { enableOnFormTags: true },
  );

  useHotkeys(
    "meta+2",
    (e) => {
      e.preventDefault();
      const entry = getFocusedEntry();
      if (!entry || !entry.pendingPlanApproval) return;
      const idx = backend.sessionEntries.indexOf(entry);
      if (idx >= 0) {
        agentRefs.current.get(idx)?.focusActiveInput();
      }
    },
    { enableOnFormTags: true },
  );

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
    <CodeBlockActionsContext.Provider value={codeBlockActions}>
    <div className="relative flex h-full flex-col">
      <FeatureTopBar featureId={featureId} projectId={projectId} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 overflow-hidden">
          <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
            {view === "loading" && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {view === "plan-input" && (
              <div className="flex-1 flex items-center justify-center overflow-auto p-6">
                <PlanInputView
                  onStartPlanning={(text, images) => {
                    descriptionRef.current = text;
                    setDescription(text);
                    backend.startPlan(
                      text || prdData?.prd || "",
                      images.map((i) => i.base64),
                    );
                  }}
                  onStartPrd={(text, images) => {
                    descriptionRef.current = text;
                    setDescription(text);
                    backend.startPrd(
                      text || prdData?.prd || "",
                      images.map((i) => i.base64),
                    );
                  }}
                  isStartingPlan={backend.isStartingPlan}
                  isStartingPrd={backend.isStartingPrd}
                />
              </div>
            )}

            {view !== "plan-input" && view !== "loading" && !maximizedAgent && (
              <div className="shrink-0 px-6 pt-6">
                <WorktreeSetupSection
                  featureId={featureId}
                  projectId={projectId}
                  wsWorktreeStatus={backend.worktreeStatus}
                  wsWorktreeBranch={backend.worktreeBranch}
                  wsWorktreeSetupOutput={backend.worktreeSetupOutput}
                  wsWorktreeError={backend.worktreeError}
                />
              </div>
            )}

            {!backend.hasAnyAgentOutput && backend.sessionEntries.length === 0 &&
              view !== "plan-input" && view !== "loading" && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {(backend.sessionEntries.length > 0 ||
              actions.canStartBuild ||
              actions.canStartRisk ||
              actions.canStartReview ||
              actions.canStartRetro) && (
              <div className={cn("flex-1 min-h-0 px-6 py-2", maximizedAgent ? "flex flex-col overflow-hidden" : "overflow-y-auto space-y-2")}>
                {(() => {
                  const renderAgent = (
                    entry: FeatureSession,
                    index: number,
                    isGridItem: boolean,
                  ) => {
                    const label =
                      (entry.agentType === "execute" ||
                        entry.agentType === "qa") &&
                      entry.phaseTitle
                        ? `${AGENT_LABELS[entry.agentType] ?? entry.agentType} - ${entry.phaseTitle}`
                        : (AGENT_LABELS[entry.agentType] ?? entry.agentType);
                    const sessionKey = `${entry.agentType}-${entry.sessionDbId}`;
                    const questions = entry.pendingQuestions ?? [];
                    const isThisMaximized = maximizedAgent === sessionKey;
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
                          openAgent === sessionKey ||
                          entry.status === "running" ||
                          entry.status === "paused"
                        }
                        onToggle={() => {
                          setOpenAgent((prev) =>
                            prev === sessionKey ? null : sessionKey,
                          );
                          // Lazy-load history when expanding a completed/paused agent
                          if (openAgent !== sessionKey && entry.blocks.length === 0 && backend.loadAgentHistory) {
                            backend.loadAgentHistory(entry);
                          }
                        }}
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
                        onMarkDone={
                          (entry.agentType === "session" ||
                            entry.agentType === "review-fixer") &&
                          (entry.status === "running" ||
                            entry.status === "paused")
                            ? () => backend.markDone(entry.sessionDbId)
                            : undefined
                        }
                        onAnswerSubmit={(response) =>
                          backend.submitAnswers(entry, response)
                        }
                        onSend={(message, images) => {
                          backend.sendToAgent(entry, message, images?.map((i: { base64: string }) => i.base64));
                        }}
                        onStop={() => {
                          backend.stopAgent(entry);
                        }}
                        resumable={entry.resumable}
                        onResume={
                          entry.resumable
                            ? () =>
                                void backend.handleResume(
                                  entry.agentType,
                                  entry.sessionDbId,
                                )
                            : undefined
                        }
                        hasFileChanges={entry.hasFileChanges}
                        onViewDiff={() => handleViewDiffForAgent(entry)}
                        todos={entry.todos}
                        currentModelId={resolveModel(entry.agentType)}
                        onModelChange={(modelId) =>
                          handleModelChange(entry.agentType, modelId)
                        }
                        canDelete={
                          entry.status !== "running" &&
                          entry.status !== "completed" &&
                          !!entry.sessionDbId
                        }
                        onDelete={() => handleDeleteAgent(entry)}
                        contextUsage={contextUsageMap.get(entry.sessionDbId)}
                        featureId={featureId}
                        projectId={projectId}
                        sessionId={entry.sessionDbId}
                        claudeSessionId={entry.claudeSessionId || undefined}
                        initialDraft={entry.draftPrompt}
                        subprocessId={entry.subprocessId ?? undefined}
                        pendingPermission={entry.pendingPermission}
                        onPermissionDecision={(decision, feedback) =>
                          backend.submitPermission(entry, decision, feedback)
                        }
                        pendingPlanApproval={entry.pendingPlanApproval}
                        planApprovalError={backend.planApprovalError}
                        planApproveLabel="Approve"
                        onPlanApprove={() =>
                          backend.approvePlan(
                            entry.subprocessId,
                            entry.sessionDbId,
                          )
                        }
                        onPlanRequestChanges={(feedback: string) =>
                          backend.rejectPlan(
                            feedback,
                            entry.subprocessId,
                            entry.sessionDbId,
                          )
                        }
                        className={
                          isGridItem
                            ? "min-h-0 h-full shrink overflow-hidden"
                            : isThisMaximized
                              ? "flex-1 min-h-0"
                              : undefined
                        }
                      />
                    );
                  };

                  const activeEntries = backend.sessionEntries.filter(
                    (e) => e.status === "running" || e.status === "paused",
                  );
                  const inactiveEntries = backend.sessionEntries.filter(
                    (e) => e.status !== "running" && e.status !== "paused",
                  );
                  const useGrid = activeEntries.length >= 2 && !maximizedAgent;

                  return (
                    <>
                      {inactiveEntries.map((entry) => {
                        const idx = backend.sessionEntries.indexOf(entry);
                        return renderAgent(entry, idx, false);
                      })}

                      {useGrid ? (
                        <div
                          className={cn(
                            "grid gap-2 min-h-0",
                            activeEntries.length === 2 && "grid-cols-2",
                            activeEntries.length >= 3 && "grid-cols-3",
                          )}
                          style={{ height: "60vh" }}
                        >
                          {activeEntries.map((entry) => {
                            const idx = backend.sessionEntries.indexOf(entry);
                            return renderAgent(entry, idx, true);
                          })}
                        </div>
                      ) : (
                        activeEntries.map((entry) => {
                          const idx = backend.sessionEntries.indexOf(entry);
                          return renderAgent(entry, idx, false);
                        })
                      )}
                    </>
                  );
                })()}

                {!maximizedAgent && actions.canStartPlan && backend.noAgentsRunning && (
                  <div className="shrink-0 flex py-4">
                    <Button
                      size="lg"
                      onClick={() => backend.startPlan(descriptionRef.current || prdData?.prd || "")}
                      disabled={backend.isStartingPlan}
                      className="gap-2"
                    >
                      {backend.isStartingPlan ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <AGENT_ICONS.plan className="size-4" />
                      )}
                      Generate Plan
                    </Button>
                  </div>
                )}

                {!maximizedAgent && (
                  <div className="shrink-0">
                    <NextStepsBar
                      show={
                        backend.noAgentsRunning &&
                        (actions.canStartBuild ||
                          actions.canStartRisk ||
                          actions.canStartReview ||
                          actions.canStartWorkflowSession ||
                          backend.canContinueBuild ||
                          backend.executeStatus !== "running" ||
                          actions.canStartRetro)
                      }
                      canStartBuild={actions.canStartBuild}
                      canStartRisk={actions.canStartRisk}
                      canStartReview={actions.canStartReview}
                      executeStatus={backend.executeStatus}
                      onStartBuilding={() => backend.startBuilding()}
                      onStartRisk={() => backend.startRisk()}
                      onStartReview={() => backend.startReview()}
                      isStartingExecute={backend.isStartingExecute}
                      isStartingRisk={backend.isStartingRisk}
                      isStartingReview={backend.isStartingReview}
                      canContinueBuild={backend.canContinueBuild}
                      onContinueBuild={() => backend.continueWorkflow()}
                      isContinuingBuild={backend.isContinuingBuild}
                      nextStepNumber={backend.executeWaitingNextStep}
                      canStartWorkflowSession={actions.canStartWorkflowSession}
                      onStartWorkflowSession={(prompt, images) => {
                        backend.startSession(prompt, images?.map((i: { base64: string }) => i.base64));
                      }}
                      isStartingWorkflowSession={backend.isStartingWorkflowSession}
                      noExecuteAgentRunning={backend.executeStatus !== "running"}
                      projectId={projectId}
                      featureId={featureId}
                      featureType={feature?.type}
                      canStartRefine={actions.canStartRefine}
                      onStartRefinePlan={(description, images) => {
                        backend.startRefine(description, images?.map((i: { base64: string }) => i.base64));
                      }}
                      isStartingRefinePlan={backend.isStartingRefinePlan}
                      openSessionPrompt={sessionPromptTrigger}
                      canStartRetro={actions.canStartRetro}
                      onStartRetro={() => backend.startRetro()}
                      isStartingRetro={backend.isStartingRetro}
                    />
                  </div>
                )}

                {!maximizedAgent && view === "done" && (
                  <div className="shrink-0 flex items-center gap-3 pt-4">
                    <CheckCircle2Icon className="size-8 text-green-600" />
                    <div>
                      <h2 className="text-lg font-semibold">
                        Feature Complete
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        This feature has been reviewed and marked as done.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {backend.error && (
              <div className="shrink-0 mx-6 mt-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangleIcon className="size-4 shrink-0" />
                <span className="flex-1">{backend.error}</span>
              </div>
            )}

          </div>

          <QueueSidebar
            queue={backend.queue ?? []}
            featureId={featureId}
            selectedItemId={backend.selectedItemId ?? null}
            onSelectItem={backend.selectItem ?? (() => {})}
            onRetryItem={backend.retryItem}
            onSkipItem={backend.skipItem}
          />
        </div>
        {terminalState.panes.length > 0 && (
          <div
            className="absolute bottom-0 left-0 right-0 z-20 border-t border-[#292e42] transition-transform duration-150 ease-in-out"
            style={{
              height: terminalState.isMinimized ? 32 : terminalHeightPx,
              transform: terminalState.isOpen
                ? "translateY(0)"
                : "translateY(100%)",
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
        onStartReviewFixer={(comments) => backend.startReviewFixer(comments)}
      />
    </div>
    </CodeBlockActionsContext.Provider>
  );
}
