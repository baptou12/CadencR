/**
 * Unified agent UI component for all agent types.
 *
 * When `collapsible` is true, renders with a header and toggle (for workflow
 * view where multiple agents show).  When false, renders full-screen (for
 * standalone session view).
 *
 * Integrates AgentQuestionDrawer (shown when pendingQuestions is non-empty)
 * and ReviewVerdictActions (shown when agentType is "review" and pattern
 * match data is provided).
 */

import { useState, useEffect, createElement, useRef, useImperativeHandle, forwardRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Loader2Icon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronRightIcon,
  PauseCircleIcon,
  RotateCcwIcon,
  FileEditIcon,
  Trash2Icon,
} from "lucide-react";
import { AgentStream } from "./AgentStream";
import { AgentPromptBar, type AgentPromptBarHandle } from "./AgentPromptBar";
import { ReviewVerdictActions } from "./ReviewVerdictActions";
import type { AgentBlockData } from "./AgentBlock";
import type { AgentType } from "../../main/agents/types";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import { AGENT_ICONS } from "./agent-icons";

// ---------------------------------------------------------------------------
// Shared types & constants (previously in AgentPanel, now canonical here)
// ---------------------------------------------------------------------------

export type AgentStatus = "idle" | "running" | "completed" | "error" | "paused";

export const AGENT_LABELS: Record<AgentType, string> = {
  plan: "Plan",
  brainstorm: "Brainstorm",
  execute: "Execute",
  risk: "Risk Analysis",
  review: "Review",
  session: "Session",
};

// ---------------------------------------------------------------------------
// Status badge configuration
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<
  AgentStatus,
  { label: string; className: string; icon?: React.ReactNode }
> = {
  idle: { label: "Idle", className: "bg-gray-500/15 text-gray-400" },
  running: {
    label: "Running",
    className: "bg-yellow-500/15 text-yellow-300",
    icon: <Loader2Icon className="size-3 animate-spin" />,
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/15 text-green-300",
    icon: <CheckCircleIcon className="size-3" />,
  },
  error: {
    label: "Error",
    className: "bg-red-500/15 text-red-300",
    icon: <XCircleIcon className="size-3" />,
  },
  paused: {
    label: "Paused",
    className: "bg-orange-500/15 text-orange-300",
    icon: <PauseCircleIcon className="size-3" />,
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentSessionProps {
  /** The type of agent being displayed */
  agentType: AgentType;
  /** The blocks (stream output) to render */
  blocks: AgentBlockData[];
  /** Current status of the agent */
  status: AgentStatus;
  /** Called when the user sends a message via the prompt bar */
  onSend: (message: string) => void;
  /** Called when the user clicks the stop button */
  onStop: () => void;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onAnswerSubmit?: (response: string) => void;
  /** When true, disables keyboard shortcuts in the question drawer */
  disableShortcuts?: boolean;
  /** Override label (e.g. "Execute 1" for parallel phases) */
  label?: string;
  /** Override icon (lucide component) */
  icon?: typeof Loader2Icon;
  /** When true, wrap content in a collapsible panel. When false, render full-screen. */
  collapsible?: boolean;
  /** Additional class names */
  className?: string;
  /** Whether to show a "resumable" indicator */
  resumable?: boolean;
  /** Called when user clicks resume */
  onResume?: () => void;
  /** Whether the prompt bar send button should be disabled */
  disabled?: boolean;
  /** Controlled open state (collapsible mode only) */
  open?: boolean;
  /** Toggle callback (collapsible mode only) */
  onToggle?: () => void;

  // --- Review verdict props (shown when agentType === "review") ---
  /** Whether the review agent has completed */
  reviewComplete?: boolean;
  /** The review verdict detected from pattern matching */
  reviewVerdict?: "approved" | "changes_requested" | null;
  /** Called when user clicks "Add Fix Phase" */
  onAddFixPhase?: () => void;
  /** Called when user clicks "Fix Immediately" */
  onFixImmediately?: () => void;
  /** Whether "Add Fix Phase" action is in progress */
  isAddingFixPhase?: boolean;
  /** Whether "Fix Immediately" action is in progress */
  isStartingFix?: boolean;
  /** Whether this agent session is keyboard-focused (shows ring outline) */
  keyboardFocused?: boolean;

  // --- Diff trigger props ---
  /** Whether the agent made file changes during its session */
  hasFileChanges?: boolean;
  /** Called when user clicks "Review Changes" to open the diff viewer */
  onViewDiff?: () => void;

  // --- Delete props ---
  /** Whether this agent can be deleted */
  canDelete?: boolean;
  /** Called when user clicks delete */
  onDelete?: () => void;
  /** The model ID used for this agent session */
  model?: string | null;
}

/** Handle exposed by AgentSession via forwardRef */
export interface AgentSessionHandle {
  /** Focus the prompt bar textarea */
  focusPromptBar: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentSession = forwardRef<AgentSessionHandle, AgentSessionProps>(function AgentSession({
  agentType,
  blocks,
  status,
  onSend,
  onStop,
  pendingQuestions,
  onAnswerSubmit,
  disableShortcuts,
  label,
  icon,
  collapsible = false,
  className,
  resumable,
  onResume,
  disabled,
  open: controlledOpen,
  onToggle,
  reviewComplete,
  reviewVerdict,
  onAddFixPhase,
  onFixImmediately,
  isAddingFixPhase,
  isStartingFix,
  keyboardFocused,
  hasFileChanges,
  onViewDiff,
  canDelete,
  onDelete,
  model,
}, ref) {
  const promptBarRef = useRef<AgentPromptBarHandle>(null);
  const [promptBarFocused, setPromptBarFocused] = useState(false);

  useImperativeHandle(ref, () => ({
    focusPromptBar: () => {
      promptBarRef.current?.focusInput();
    },
  }));
  // ---- Collapsible state ----
  const [internalOpen, setInternalOpen] = useState(true);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  // Auto-open when agent starts running (uncontrolled mode only)
  useEffect(() => {
    if ((status === "running" || status === "paused") && !isControlled) {
      setInternalOpen(true);
    }
  }, [status, isControlled]);

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalOpen((prev) => !prev);
    }
  };

  const isIdle = status === "idle" && blocks.length === 0;
  const badge = STATUS_BADGE[status];
  const IconComponent = icon ?? AGENT_ICONS[agentType];
  const displayLabel = label ?? AGENT_LABELS[agentType];

  // Determine whether the prompt bar should be shown
  const shouldShowPromptBar = (() => {
    // Always show in non-collapsible (full-screen) mode unless totally idle with no blocks
    if (!collapsible) return true;

    // In collapsible mode:
    // Show when agent has output, is running, or has pending questions.
    // Hidden for one-shot agents (plan, brainstorm) once they complete.
    const hasOutput = blocks.length > 0;
    const hasQuestions = pendingQuestions && pendingQuestions.length > 0;
    const isOneShot = agentType === "plan" || agentType === "brainstorm";
    if (isOneShot && status === "completed") return false;
    return status !== "idle" || hasOutput || !!hasQuestions;
  })();

  // ---- Review verdict section (for review agent only) ----
  const reviewVerdictSection =
    agentType === "review" &&
    onAddFixPhase &&
    onFixImmediately ? (
      <ReviewVerdictActions
        show={true}
        reviewComplete={reviewComplete ?? false}
        reviewVerdict={reviewVerdict ?? null}
        onAddFixPhase={onAddFixPhase}
        onFixImmediately={onFixImmediately}
        isAddingFixPhase={isAddingFixPhase ?? false}
        isStartingFix={isStartingFix ?? false}
      />
    ) : null;

  // ---- Inline diff trigger bar ----
  const showDiffBar =
    hasFileChanges && onViewDiff;

  const diffBar = showDiffBar ? (
    <div
      className="flex cursor-pointer items-center gap-2 border-t border-border bg-muted px-4 py-2 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      onClick={onViewDiff}
    >
      <FileEditIcon className="size-3.5" />
      <span>Files changed &mdash; <span className="underline underline-offset-2">Review Changes</span></span>
    </div>
  ) : null;

  // ---- Stream content ----
  const streamContent = (
    <>
      {isIdle && (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {collapsible ? "No output yet" : "Send a message to start a session with Claude Code."}
          </p>
        </div>
      )}
      {blocks.length > 0 && (
        <AgentStream blocks={blocks} isStreaming={status === "running"} autoScroll={promptBarFocused} />
      )}
    </>
  );

  // ---- Prompt bar ----
  const promptBar = shouldShowPromptBar ? (
    <AgentPromptBar
      ref={promptBarRef}
      onSend={onSend}
      onStop={onStop}
      status={status}
      disabled={disabled}
      pendingQuestions={pendingQuestions}
      onQuestionResponse={onAnswerSubmit}
      disableShortcuts={disableShortcuts}
      onFocusChange={setPromptBarFocused}
    />
  ) : null;

  // ===========================================================================
  // Full-screen mode (collapsible = false)
  // ===========================================================================
  if (!collapsible) {
    return (
      <div className={cn("flex h-full flex-col", className)}>
        {/* Scrollable agent output */}
        <div className="flex-1 overflow-auto p-4">
          {streamContent}
        </div>

        {/* Review verdict actions */}
        {reviewVerdictSection}

        {/* Inline diff trigger */}
        {diffBar}

        {/* Prompt bar pinned at bottom */}
        {promptBar && (
          <div>
            {promptBar}
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // Collapsible mode (collapsible = true)
  // ===========================================================================
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-background",
        className,
      )}
    >
      {/* Header -- clickable to toggle */}
      <div
        className={cn(
          "flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/50",
          keyboardFocused && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        )}
        onClick={handleToggle}
        data-nav-item
        tabIndex={-1}
      >
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-90",
          )}
        />
        {createElement(IconComponent, {
          className: "size-4 text-muted-foreground",
        })}
        <span className="text-sm font-medium">{displayLabel}</span>
        <Badge
          variant="secondary"
          className={cn("gap-1 text-xs", badge.className)}
        >
          {badge.icon}
          {badge.label}
        </Badge>
        {model && (
          <span className="text-xs text-muted-foreground">
            {model.includes("opus") ? "Opus" : model.includes("sonnet") ? "Sonnet" : model.includes("haiku") ? "Haiku" : model}
          </span>
        )}
        {resumable && onResume && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onResume();
            }}
          >
            <RotateCcwIcon className="size-3" />
            Resume
          </Button>
        )}
        {canDelete && onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-red-400", !resumable && "ml-auto")}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2Icon className="size-3" />
            Remove
          </Button>
        )}
      </div>

      {/* Collapsible content */}
      {isOpen && (
        <>
          <div className="border-t border-border">
            {/* Stream content */}
            {blocks.length === 0 && status === "idle" ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                No output yet
              </div>
            ) : (
              <AgentStream blocks={blocks} isStreaming={status === "running"} autoScroll={promptBarFocused} />
            )}
          </div>

          {/* Review verdict actions */}
          {reviewVerdictSection}

          {/* Inline diff trigger */}
          {diffBar}

          {/* Prompt bar */}
          {promptBar && (
            <div className="border-t border-border">
              {promptBar}
            </div>
          )}
        </>
      )}
    </div>
  );
});
