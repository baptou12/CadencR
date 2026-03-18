import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeatureTopBar } from "@/components/FeatureTopBar";
import { PlanInputView } from "@/components/PlanInputView";
import type { PlanInputImage } from "@/components/PlanInputView";
import { AgentSession } from "@/components/AgentSession";
import type { AgentSessionHandle } from "@/components/AgentSession";
import { QueueSidebar } from "@/components/QueueSidebar";
import {
  useWorkflowStore,
  type AutonomyLevel,
} from "@/hooks/useWorkflowWebSocket";
import type { AgentType } from "../../main/agents/types";
import { CheckCircle2Icon, PlayIcon, SkipForwardIcon, RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WsFeatureView({ featureId, projectId }: WsFeatureViewProps) {
  const store = useWorkflowStore();
  const agentRef = useRef<AgentSessionHandle>(null);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    store.connect(featureId, projectId);
    return () => store.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId, projectId]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // CMD+SHIFT+B → start build
      if (e.metaKey && e.shiftKey && e.key === "b") {
        e.preventDefault();
        if (store.workflowStatus === "plan_approval") {
          store.approvePlan();
        }
        return;
      }
      // CMD+OPT+UP/DOWN → navigate sidebar
      if (e.metaKey && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const { queue, selectedItemId, selectItem } = store;
        if (queue.length === 0) return;
        const currentIdx = queue.findIndex(q => q.id === selectedItemId);
        const next = e.key === "ArrowDown"
          ? Math.min(currentIdx + 1, queue.length - 1)
          : Math.max(currentIdx - 1, 0);
        selectItem(queue[next].id);
        return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);

  // Handlers
  const handleStartPlanning = useCallback(
    (description: string, images: PlanInputImage[]) => store.startPlan(description, images),
    [store],
  );
  const handleStartPrd = useCallback(
    (description: string, images: PlanInputImage[]) => store.startPrd(description, images),
    [store],
  );

  // Selected agent
  const selectedAgent = useMemo(() => {
    if (store.selectedItemId != null) {
      return store.activeAgents.get(store.selectedItemId) ?? null;
    }
    return null;
  }, [store.selectedItemId, store.activeAgents]);

  const selectedItem = useMemo(
    () => store.queue.find(q => q.id === store.selectedItemId) ?? null,
    [store.queue, store.selectedItemId],
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderAutonomySelector = () => (
    <div className="flex items-center gap-2 text-xs text-gray-400">
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

  const renderPlanAgent = () => {
    if (!store.planAgent) return null;
    return (
      <AgentSession
        ref={agentRef}
        agentType="plan"
        blocks={store.planAgent.blocks}
        status={store.planAgent.status}
        onSend={(msg, images) => store.sendPromptToAgent(-1, msg, images)}
        onStop={() => {}}
        pendingPermission={store.planAgent.pendingPermission}
        featureId={featureId}
        projectId={projectId}
      />
    );
  };

  const renderPrdAgent = () => {
    if (!store.prdAgent) return null;
    return (
      <AgentSession
        agentType="prd"
        blocks={store.prdAgent.blocks}
        status={store.prdAgent.status}
        onSend={(msg, images) => store.sendPromptToAgent(-2, msg, images)}
        onStop={() => {}}
        pendingPermission={store.prdAgent.pendingPermission}
        featureId={featureId}
        projectId={projectId}
        collapsible
      />
    );
  };

  const renderPlanApproval = () => (
    <div className="flex flex-1 flex-col">
      {renderPlanAgent()}
      <div className="flex items-center justify-center gap-3 border-t border-gray-800 p-4">
        <button
          type="button"
          onClick={() => store.approvePlan()}
          className="flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
        >
          <PlayIcon className="size-4" />
          Approve &amp; Build
        </button>
        <RejectPlanButton onReject={(feedback) => store.rejectPlan(feedback)} />
      </div>
    </div>
  );

  const renderBuildingView = () => (
    <div className="flex flex-1 overflow-hidden">
      {/* Main panel — selected agent */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {renderAutonomySelector()}
        {selectedAgent && selectedItem ? (
          <AgentSession
            ref={agentRef}
            agentType={itemTypeToAgentType(selectedItem.item_type)}
            blocks={selectedAgent.blocks}
            status={selectedAgent.status}
            label={selectedItem.phase_title ?? selectedItem.item_type}
            onSend={(msg, images) => store.sendPromptToAgent(selectedItem.id, msg, images)}
            onStop={() => {}}
            pendingPermission={selectedAgent.pendingPermission}
            onPermissionDecision={(decision) => {
              store.respondToPermission(selectedItem.id, "", decision);
            }}
            featureId={featureId}
            projectId={projectId}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">
            Select a queue item to view its agent session
          </div>
        )}
      </div>
      {/* Queue sidebar */}
      <QueueSidebar
        queue={store.queue}
        selectedItemId={store.selectedItemId}
        onSelectItem={store.selectItem}
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
          {/* If there's an errored item, show skip/retry */}
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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <CheckCircle2Icon className="size-12 text-green-400" />
      <h2 className="text-lg font-medium text-gray-200">Workflow Complete</h2>
      <p className="text-sm text-gray-400">
        {store.queue.filter(q => q.status === "completed").length} of {store.queue.length} items completed
      </p>
      {/* Show sidebar for reviewing completed items */}
      <div className="mt-4 w-72">
        <QueueSidebar
          queue={store.queue}
          selectedItemId={store.selectedItemId}
          onSelectItem={store.selectItem}
        />
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  const renderContent = () => {
    switch (store.workflowStatus) {
      case "idle":
        return renderPlanInput();
      case "planning":
        return <div className="flex flex-1 flex-col overflow-hidden">{renderPlanAgent()}</div>;
      case "prd":
        return (
          <div className="flex flex-1 flex-col overflow-hidden">
            {renderPrdAgent()}
          </div>
        );
      case "plan_approval":
        return renderPlanApproval();
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
    <div className="flex h-full flex-col">
      <FeatureTopBar
        featureId={featureId}
        projectId={projectId}
        mode="feature"
        isWebSocket
        className="shrink-0"
      />
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
