import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { PlanInputView } from "@/components/PlanInputView";
import type { PlanInputImage } from "@/components/PlanInputView";
import { AgentSession } from "@/components/AgentSession";
import type { AgentSessionHandle } from "@/components/AgentSession";
import { QueueSidebar } from "@/components/QueueSidebar";
import { WorktreeSetupSection } from "@/components/WorktreeSetupSection";
import { WorkflowActionsBar } from "@/components/WorkflowActionsBar";
import {
  useWorkflowStore,
  type AutonomyLevel,
  type AgentSessionState,
} from "@/hooks/useWorkflowWebSocket";
import { useCreateWorktree } from "@/api/generated";
import type { AgentType } from "../../main/agents/types";
import { CheckCircle2Icon, PlayIcon, SkipForwardIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveFocusZone } from "@/lib/focus-zones";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WsFeatureViewProps {
  featureId: number;
  projectId: number;
  feature: {
    id: number;
    title: string;
    status: string;
    type: string;
    project_id: number;
    created_at: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_LABELS: Record<string, string> = {
  plan: "Plan",
  prd: "PRD",
  execute: "Execute",
  review: "Review",
  risk: "Risk",
  qa: "QA",
  retro: "Retro",
  "review-fixer": "Review Fixer",
};

/** Map queue item_type to AgentType for the AgentSession component. */
function itemTypeToAgentType(itemType: string): AgentType {
  const map: Record<string, AgentType> = {
    execute: "execute",
    review: "review",
    risk: "risk",
    qa: "qa",
    retro: "retro",
    "review-fixer": "review-fixer",
  };
  return map[itemType] ?? "execute";
}

const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  1: "Step by step",
  2: "Pause between groups",
  3: "Full auto",
};

/** Unique key for an agent entry (plan/prd use negative synthetic IDs). */
type AgentEntry = {
  key: string;
  queueItemId: number;
  agentType: AgentType;
  label: string;
  state: AgentSessionState;
  orderIndex: number;
};

function isActiveStatus(status: string): boolean {
  return status === "running" || status === "paused";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WsFeatureView({ featureId, projectId, feature }: WsFeatureViewProps) {
  const store = useWorkflowStore();
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const agentRefs = useRef<Map<number, AgentSessionHandle | null>>(new Map());
  const createWorktree = useCreateWorktree();

  const setAgentRef = useCallback((index: number, handle: AgentSessionHandle | null) => {
    if (handle) {
      agentRefs.current.set(index, handle);
    } else {
      agentRefs.current.delete(index);
    }
  }, []);

  // Ref for scrolling to agents
  const agentPanelRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    store.connect(featureId, projectId);
    return () => store.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId, projectId]);

  // Approve plan: create worktree first, then send approval
  const handleApprovePlan = useCallback(() => {
    createWorktree.mutate(
      { projectId, featureId, featureTitle: feature.title },
      {
        onSuccess: () => store.approvePlan(),
        onError: (err) => {
          console.error("Worktree creation failed, proceeding with plan approval:", err);
          // Still approve — worktree failure shouldn't block the workflow
          store.approvePlan();
        },
      },
    );
  }, [createWorktree, projectId, featureId, feature.title, store]);

  // ---------------------------------------------------------------------------
  // Focus helpers
  // ---------------------------------------------------------------------------

  /** Walk DOM from activeElement to find which agentEntry index is focused */
  const getFocusedAgentIndex = useCallback((): number | null => {
    let el = document.activeElement as HTMLElement | null;
    while (el) {
      const attr = el.getAttribute("data-agent-container");
      if (attr != null) return Number(attr);
      el = el.parentElement;
    }
    return null;
  }, []);

  const moveFocus = useCallback(
    (direction: "up" | "down") => {
      const count = agentEntries.length;
      if (count === 0) return;
      const current = getFocusedAgentIndex();
      let nextIndex: number;
      if (current == null) {
        nextIndex = direction === "down" ? 0 : count - 1;
      } else if (direction === "down") {
        nextIndex = current >= count - 1 ? 0 : current + 1;
      } else {
        nextIndex = current <= 0 ? count - 1 : current - 1;
      }
      agentRefs.current.get(nextIndex)?.focusActiveInput();
    },
    [agentEntries, getFocusedAgentIndex],
  );

  // Auto-focus on new agent start
  const prevRunningKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentRunning = new Set(
      agentEntries
        .filter(e => isActiveStatus(e.state.status))
        .map(e => e.key),
    );
    for (const key of currentRunning) {
      if (!prevRunningKeysRef.current.has(key)) {
        // New agent started — auto-expand and focus
        setOpenAgent(key);
        const idx = agentEntries.findIndex(e => e.key === key);
        if (idx >= 0) {
          requestAnimationFrame(() => {
            agentRefs.current.get(idx)?.focusPromptBar();
          });
        }
        break;
      }
    }
    prevRunningKeysRef.current = currentRunning;
  }, [agentEntries]);

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts (react-hotkeys-hook)
  // ---------------------------------------------------------------------------

  // CMD+OPT+DOWN — focus next agent
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

  // CMD+OPT+UP — focus previous agent
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

  // CMD+SHIFT+B — approve plan or continue workflow
  useHotkeys(
    "meta+shift+b",
    (e) => {
      e.preventDefault();
      if (store.workflowStatus === "plan_approval") {
        handleApprovePlan();
      } else if (store.workflowStatus === "paused") {
        store.continueWorkflow();
      }
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+S — open session prompt bar (trigger counter for WorkflowActionsBar)
  const [_sessionPromptTrigger, setSessionPromptTrigger] = useState(0);
  useHotkeys(
    "meta+shift+s",
    (e) => {
      if (store.workflowStatus !== "building" && store.workflowStatus !== "completed") return;
      e.preventDefault();
      setSessionPromptTrigger(v => v + 1);
    },
    { enableOnFormTags: true },
  );

  // ENTER — toggle expand/collapse on focused agent header; if running, expand & focus prompt
  useHotkeys(
    "enter",
    (e) => {
      if (getActiveFocusZone() !== "main-content") return;
      const focused = document.activeElement as HTMLElement | null;
      if (!focused?.hasAttribute("data-nav-item")) return;
      const agentIndexStr = focused.getAttribute("data-nav-agent-index");
      if (agentIndexStr == null) return;
      const agentIndex = Number(agentIndexStr);
      const entry = agentEntries[agentIndex];
      if (!entry) return;
      const isWorking = isActiveStatus(entry.state.status);
      if (isWorking) {
        e.preventDefault();
        setOpenAgent(entry.key);
        requestAnimationFrame(() => {
          agentRefs.current.get(agentIndex)?.focusActiveInput();
        });
      } else {
        e.preventDefault();
        setOpenAgent(prev => (prev === entry.key ? null : entry.key));
      }
    },
    { enableOnFormTags: false },
  );

  // ESC — interrupt focused running agent
  useHotkeys(
    "escape",
    (e) => {
      const agentIndex = getFocusedAgentIndex();
      if (agentIndex == null) return;
      const entry = agentEntries[agentIndex];
      if (!entry || !isActiveStatus(entry.state.status)) return;
      e.preventDefault();
      store.interruptItem(entry.queueItemId);
    },
    { enableOnFormTags: true },
  );

  // CMD+1 — approve plan (when plan_approval status)
  useHotkeys(
    "meta+1",
    (e) => {
      if (store.workflowStatus !== "plan_approval") return;
      e.preventDefault();
      handleApprovePlan();
    },
    { enableOnFormTags: true },
  );

  // CMD+2 — focus plan feedback input (when plan_approval status)
  useHotkeys(
    "meta+2",
    (e) => {
      if (store.workflowStatus !== "plan_approval") return;
      e.preventDefault();
      // Focus the plan agent's input so user can type feedback
      const planIndex = agentEntries.findIndex(entry => entry.key === "plan");
      if (planIndex >= 0) {
        agentRefs.current.get(planIndex)?.focusActiveInput();
      }
    },
    { enableOnFormTags: true },
  );

  // Handlers
  const handleStartPlanning = useCallback(
    (description: string, images: PlanInputImage[]) => store.startPlan(description, images),
    [store],
  );
  const handleStartPrd = useCallback(
    (description: string, images: PlanInputImage[]) => store.startPrd(description, images),
    [store],
  );

  // ---------------------------------------------------------------------------
  // Build unified agent entries list
  // ---------------------------------------------------------------------------

  const agentEntries = useMemo((): AgentEntry[] => {
    const entries: AgentEntry[] = [];

    // Plan agent (synthetic id -1)
    if (store.planAgent) {
      entries.push({
        key: "plan",
        queueItemId: -1,
        agentType: "plan" as AgentType,
        label: "Plan",
        state: store.planAgent,
        orderIndex: -2,
      });
    }

    // PRD agent (synthetic id -2)
    if (store.prdAgent) {
      entries.push({
        key: "prd",
        queueItemId: -2,
        agentType: "prd" as AgentType,
        label: "PRD",
        state: store.prdAgent,
        orderIndex: -1,
      });
    }

    // Queue agents
    for (const [queueItemId, agentState] of store.activeAgents) {
      const queueItem = store.queue.find(q => q.id === queueItemId);
      const agentType = itemTypeToAgentType(queueItem?.item_type ?? "execute");
      entries.push({
        key: `queue-${queueItemId}`,
        queueItemId,
        agentType,
        label: queueItem?.phase_title ?? AGENT_LABELS[agentType] ?? agentType,
        state: agentState,
        orderIndex: queueItem?.order_index ?? 999,
      });
    }

    // Sort: plan first, prd second, then by order_index
    entries.sort((a, b) => a.orderIndex - b.orderIndex);

    return entries;
  }, [store.planAgent, store.prdAgent, store.activeAgents, store.queue]);

  const inactiveEntries = useMemo(
    () => agentEntries.filter(e => !isActiveStatus(e.state.status)),
    [agentEntries],
  );
  const activeEntries = useMemo(
    () => agentEntries.filter(e => isActiveStatus(e.state.status)),
    [agentEntries],
  );

  // Auto-open running agents
  useEffect(() => {
    if (activeEntries.length > 0 && openAgent == null) {
      setOpenAgent(activeEntries[0].key);
    }
  }, [activeEntries, openAgent]);

  // Handle sidebar click → scroll to agent
  const handleSidebarSelect = useCallback((itemId: number) => {
    store.selectItem(itemId);
    const key = `queue-${itemId}`;
    const el = agentPanelRefs.current.get(key);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setOpenAgent(key);
    }
  }, [store]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const allItemsDone = useMemo(
    () => store.queue.length > 0 && store.queue.every(q => q.status === "completed" || q.status === "skipped"),
    [store.queue],
  );

  const renderActionsBar = () => (
    <WorkflowActionsBar
      workflowStatus={store.workflowStatus}
      featureId={featureId}
      projectId={projectId}
      featureType={feature.type}
      allItemsDone={allItemsDone}
      onStartSession={(prompt, images) => store.startSession(prompt, images)}
      onStartRefine={(desc, images) => store.startRefine(desc, images)}
    />
  );

  const renderAutonomySelector = () => (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400">
      <span>Autonomy:</span>
      {([1, 2, 3] as AutonomyLevel[]).map(level => (
        <button
          key={level}
          type="button"
          onClick={() => store.setAutonomyLevel(level)}
          className={cn(
            "rounded px-2 py-0.5 transition-colors",
            store.autonomyLevel === level
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:bg-gray-700",
          )}
        >
          {AUTONOMY_LABELS[level]}
        </button>
      ))}
    </div>
  );

  const renderPlanInput = () => (
    <div className="flex flex-1 items-center justify-center p-8">
      <PlanInputView
        onStartPlanning={handleStartPlanning}
        onStartPrd={handleStartPrd}
        isStartingPlan={store.workflowStatus === "planning"}
        isStartingPrd={store.workflowStatus === "prd"}
      />
    </div>
  );

  const renderPlanApprovalButtons = () => (
    <div className="flex items-center justify-center gap-3 border-t border-gray-800 p-4">
      <button
        type="button"
        onClick={handleApprovePlan}
        className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
      >
        <PlayIcon className="size-4" />
        Approve &amp; Build
      </button>
      <RejectPlanButton onReject={(feedback) => store.rejectPlan(feedback)} />
    </div>
  );

  // Derive review verdict from completed review agents in activeAgents
  const reviewVerdict = useMemo((): "changes_requested" | null => {
    for (const [, agentState] of store.activeAgents) {
      // Check if any completed agent has finalize_phases tool call
      if (agentState.status !== "completed") continue;
      const calledFinalizePhases = agentState.blocks.some(
        (b) => b.type === "tool_call" && b.toolName === "finalize_phases",
      );
      if (calledFinalizePhases) return "changes_requested";
    }
    return null;
  }, [store.activeAgents]);

  const renderAgentPanel = (entry: AgentEntry, index: number) => {
    const isOpen = openAgent === entry.key || isActiveStatus(entry.state.status);
    const isReview = entry.agentType === "review";
    const canMarkDone = entry.state.status === "running" && (entry.queueItemId < 0);
    const canDelete = !isActiveStatus(entry.state.status) && entry.queueItemId < 0;

    return (
      <div
        key={entry.key}
        ref={(el) => { agentPanelRefs.current.set(entry.key, el); }}
        data-agent-container={index}
      >
        <AgentSession
          ref={(handle) => setAgentRef(index, handle)}
          agentType={entry.agentType}
          blocks={entry.state.blocks}
          status={entry.state.status}
          label={entry.label}
          navAgentIndex={index}
          collapsible
          open={isOpen}
          onToggle={() => setOpenAgent(prev => prev === entry.key ? null : entry.key)}
          onSend={(msg, images) => store.sendPromptToAgent(entry.queueItemId, msg, images)}
          onStop={() => store.interruptItem(entry.queueItemId)}
          onMarkDone={canMarkDone ? () => store.markDone(entry.queueItemId) : undefined}
          onDelete={canDelete ? () => store.removeAgent(entry.queueItemId) : undefined}
          pendingPermission={entry.state.pendingPermission}
          onPermissionDecision={(decision) => {
            store.respondToPermission(
              entry.queueItemId,
              entry.state.pendingPermission?.requestId ?? "",
              decision,
            );
          }}
          {...(isReview ? {
            reviewVerdict,
            onFixImmediately: () => store.startReviewFixer("Fix issues found during review"),
          } : {})}
          featureId={featureId}
          projectId={projectId}
        />
      </div>
    );
  };

  const renderStackedAgents = () => {
    if (agentEntries.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
          Waiting for agents to start…
        </div>
      );
    }

    let agentIndex = 0;

    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Inactive (completed/idle/error) agents — collapsed */}
        {inactiveEntries.map(entry => renderAgentPanel(entry, agentIndex++))}

        {/* Active agents */}
        {activeEntries.length === 1 && renderAgentPanel(activeEntries[0], agentIndex++)}
        {activeEntries.length >= 2 && (
          <div
            className={cn(
              "grid gap-2 p-2",
              activeEntries.length === 2 ? "grid-cols-2" : "grid-cols-3",
            )}
            style={{ height: "60vh" }}
          >
            {activeEntries.map(entry => renderAgentPanel(entry, agentIndex++))}
          </div>
        )}
      </div>
    );
  };

  const renderBuildingView = () => (
    <div className="flex flex-1 overflow-hidden">
      {/* Main panel — stacked agents */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {renderAutonomySelector()}
        {renderStackedAgents()}
        {renderActionsBar()}
      </div>
      {/* Queue sidebar */}
      <QueueSidebar
        queue={store.queue}
        featureId={featureId}
        selectedItemId={store.selectedItemId}
        onSelectItem={handleSidebarSelect}
        onRetryItem={(id) => store.retryItem(id)}
        onSkipItem={(id) => store.skipItem(id)}
        className="w-64 shrink-0 border-l border-gray-800"
      />
    </div>
  );

  const renderPausedOverlay = () => (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
      <div className="flex flex-col items-center gap-3 rounded-lg bg-gray-900 p-6 shadow-xl">
        <p className="text-sm text-gray-300">
          {store.pauseReason ?? "Workflow paused"}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => store.continueWorkflow()}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            <PlayIcon className="size-4" />
            Continue
          </button>
          {store.queue
            .filter(q => q.status === "error")
            .map(q => (
              <div key={q.id} className="flex gap-1">
                <button
                  type="button"
                  onClick={() => store.retryItem(q.id)}
                  className="flex items-center gap-1 rounded-md bg-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-600"
                >
                  <RotateCcwIcon className="size-3" />
                  Retry {q.phase_title ?? q.item_type}
                </button>
                <button
                  type="button"
                  onClick={() => store.skipItem(q.id)}
                  className="flex items-center gap-1 rounded-md bg-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-600"
                >
                  <SkipForwardIcon className="size-3" />
                  Skip
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );

  const renderCompleted = () => (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        {agentEntries.length > 0 ? (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-2 px-3 py-2">
              <CheckCircle2Icon className="size-5 text-green-400" />
              <span className="text-sm font-medium text-gray-200">Workflow Complete</span>
              <span className="text-xs text-gray-500">
                {store.queue.filter(q => q.status === "completed").length}/{store.queue.length} items
              </span>
            </div>
            {agentEntries.map((entry, i) => renderAgentPanel(entry, i))}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
            <CheckCircle2Icon className="size-12 text-green-400" />
            <h2 className="text-lg font-medium text-gray-200">Workflow Complete</h2>
            <p className="text-sm text-gray-400">
              {store.queue.filter(q => q.status === "completed").length} of {store.queue.length} items completed
            </p>
          </div>
        )}
        {renderActionsBar()}
      </div>
      <QueueSidebar
        queue={store.queue}
        featureId={featureId}
        selectedItemId={store.selectedItemId}
        onSelectItem={handleSidebarSelect}
        className="w-64 shrink-0 border-l border-gray-800"
      />
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render — stacked layout for all workflow states
  // ---------------------------------------------------------------------------

  const renderContent = () => {
    switch (store.workflowStatus) {
      case "idle":
        return renderPlanInput();

      case "planning":
        // Plan agent as only panel, expanded
        return (
          <div className="flex flex-1 flex-col overflow-hidden">
            {renderStackedAgents()}
          </div>
        );

      case "prd":
        return (
          <div className="flex flex-1 flex-col overflow-hidden">
            {renderStackedAgents()}
          </div>
        );

      case "plan_approval":
        return (
          <div className="flex flex-1 flex-col overflow-hidden">
            {renderStackedAgents()}
            {renderPlanApprovalButtons()}
          </div>
        );

      case "building":
        return renderBuildingView();

      case "paused":
        return (
          <div className="relative flex flex-1 overflow-hidden">
            {renderBuildingView()}
            {renderPausedOverlay()}
          </div>
        );

      case "completed":
        return renderCompleted();

      case "error":
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
            <p className="text-sm text-red-400">{store.error ?? "An error occurred"}</p>
            <button
              type="button"
              onClick={() => store.continueWorkflow()}
              className="rounded-md bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              Retry
            </button>
          </div>
        );

      default:
        return renderPlanInput();
    }
  };

  return (
    <div className="flex h-full flex-col" data-focus-zone="main-content">
      <FeatureTopBar
        featureId={featureId}
        projectId={projectId}
        mode="feature"
        isWebSocket
        className="shrink-0"
      />
      {store.workflowStatus !== "idle" && (
        <WorktreeSetupSection featureId={featureId} projectId={projectId} />
      )}
      {renderContent()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reject plan button with inline feedback textarea
// ---------------------------------------------------------------------------

function RejectPlanButton({ onReject }: { onReject: (feedback: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (feedback.trim()) {
      onReject(feedback.trim());
      setFeedback("");
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (isOpen) {
            submit();
          } else {
            setIsOpen(true);
            setTimeout(() => ref.current?.focus(), 0);
          }
        }}
        className="rounded-md bg-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
      >
        Request Changes
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-72">
          <textarea
            ref={ref}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Describe requested changes…"
            className="w-full rounded-md border border-gray-700 bg-gray-900 p-2 text-sm text-gray-300 placeholder:text-gray-600 focus:border-blue-500 focus:outline-none"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.metaKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                setIsOpen(false);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
