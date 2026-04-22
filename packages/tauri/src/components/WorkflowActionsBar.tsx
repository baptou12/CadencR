import { useState, useRef, useMemo, useEffect } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import {
  GitMergeIcon,
  Loader2Icon,
  MessageSquareIcon,
  PencilIcon,
  HistoryIcon,
} from "lucide-react";
import { MergeArchiveDialog } from "@/components/MergeArchiveDialog";
import { AgentPromptBar } from "@/components/AgentPromptBar";
import type { SplitSendAction, AgentPromptBarHandle } from "@/components/AgentPromptBar";
import { cn } from "@/lib/utils";

interface WorkflowActionsBarProps {
  workflowStatus: string;
  featureId: number;
  projectId: number;
  featureType?: string;
  noExecuteAgentRunning: boolean;
  onStartSession: (prompt: string, images?: Array<{ base64: string; mimeType: string }>) => void;
  onStartRefine: (
    description: string,
    images?: Array<{ base64: string; mimeType: string }>,
  ) => void;
  className?: string;
}

export function WorkflowActionsBar({
  workflowStatus,
  featureId,
  projectId,
  featureType,
  noExecuteAgentRunning,
  onStartSession,
  onStartRefine,
  className,
}: WorkflowActionsBarProps) {
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [showRefinePrompt, setShowRefinePrompt] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isStartingRefine, setIsStartingRefine] = useState(false);
  const sessionPromptRef = useRef<AgentPromptBarHandle>(null);
  const refinePromptRef = useRef<AgentPromptBarHandle>(null);

  const canMerge =
    noExecuteAgentRunning && (featureType === "feature" || featureType === "ws-feature");

  // Auto-focus prompt bars when opened
  useEffect(() => {
    if (showSessionPrompt) {
      requestAnimationFrame(() => sessionPromptRef.current?.focusInput());
    }
  }, [showSessionPrompt]);

  useEffect(() => {
    if (showRefinePrompt) {
      requestAnimationFrame(() => refinePromptRef.current?.focusInput());
    }
  }, [showRefinePrompt]);

  // CMD+SHIFT+M: open merge dialog
  useGlobalShortcut(
    "meta+shift+m",
    (e) => {
      e.preventDefault();
      setMergeDialogOpen(true);
    },
    { enabled: canMerge },
  );

  const sessionSplitActions: SplitSendAction[] = useMemo(
    () => [
      {
        label: "Start Session",
        icon: isStartingSession ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <MessageSquareIcon className="mr-2 size-4" />
        ),
        variant: "default" as const,
        kbdShortcut: ["enter"],
        onClick: (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
          setIsStartingSession(true);
          onStartSession(text, images);
          setShowSessionPrompt(false);
          // Reset after a delay
          setTimeout(() => setIsStartingSession(false), 2000);
        },
      },
    ],
    [isStartingSession, onStartSession],
  );

  const refineSplitActions: SplitSendAction[] = useMemo(
    () => [
      {
        label: "Refine Plan",
        icon: isStartingRefine ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <PencilIcon className="mr-2 size-4" />
        ),
        variant: "default" as const,
        kbdShortcut: ["enter"],
        onClick: (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
          setIsStartingRefine(true);
          onStartRefine(text, images);
          setShowRefinePrompt(false);
          setTimeout(() => setIsStartingRefine(false), 2000);
        },
      },
    ],
    [isStartingRefine, onStartRefine],
  );

  const isCompleted = workflowStatus === "completed";
  const isBuilding = workflowStatus === "building" || workflowStatus === "paused";

  // Show actions bar for building or completed states
  if (!isBuilding && !isCompleted) return null;

  return (
    <div className={cn("border-t border-gray-800 px-3 py-2 space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Session button — always available during building/completed */}
        <button
          type="button"
          onClick={() => setShowSessionPrompt((v) => !v)}
          className="flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          <MessageSquareIcon className="size-3.5" />
          Start Session
        </button>

        {/* Refine plan — available during building/completed */}
        <button
          type="button"
          onClick={() => setShowRefinePrompt((v) => !v)}
          className="flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          <PencilIcon className="size-3.5" />
          Refine Plan
        </button>

        {/* Merge & Archive — only when completed */}
        {isCompleted && canMerge && (
          <button
            type="button"
            onClick={() => setMergeDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            <GitMergeIcon className="size-3.5" />
            Merge &amp; Archive
          </button>
        )}

        {/* Run Retrospective — when completed */}
        {isCompleted && (
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-gray-500 opacity-60"
            title="Coming soon"
          >
            <HistoryIcon className="size-3.5" />
            Run Retrospective
          </button>
        )}
      </div>

      {/* Session prompt bar */}
      {showSessionPrompt && (
        <div className="rounded-lg border border-gray-700">
          <AgentPromptBar
            ref={sessionPromptRef}
            onSend={() => {}}
            onStop={() => {}}
            status="idle"
            disabled={isStartingSession}
            splitSendActions={sessionSplitActions}
          />
        </div>
      )}

      {/* Refine prompt bar */}
      {showRefinePrompt && (
        <div className="rounded-lg border border-gray-700">
          <AgentPromptBar
            ref={refinePromptRef}
            onSend={() => {}}
            onStop={() => {}}
            status="idle"
            disabled={isStartingRefine}
            splitSendActions={refineSplitActions}
          />
        </div>
      )}

      {/* Merge dialog */}
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
