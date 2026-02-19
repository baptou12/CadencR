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

import { useState, useEffect, useCallback, useMemo, createElement, useRef, useImperativeHandle, forwardRef, useLayoutEffect } from "react";
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
  ChevronDownIcon,
  CheckIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { AgentStream } from "./AgentStream";
import { AgentPromptBar, type AgentPromptBarHandle } from "./AgentPromptBar";
import { AgentTodoList } from "./AgentTodoList";
import { ContextUsageBar } from "./ContextUsageBar";
import { ReviewVerdictActions } from "./ReviewVerdictActions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { AgentBlockData } from "./AgentBlock";
import type { AgentType } from "../../main/agents/types";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import type { TodoItem } from "@/hooks/useFeatureAgentState";
import type { ContextUsageState } from "@/hooks/useContextUsage";
import type { PendingPermission } from "./ToolPermissionPrompt";
import { ToolPermissionPrompt } from "./ToolPermissionPrompt";
import { AGENT_ICONS } from "./agent-icons";
import { trpc } from "../trpc";

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
  qa: "QA",
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
  /** Index for DOM-based keyboard navigation (sets data-nav-agent-index) */
  navAgentIndex?: number;

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
  /** Todo list from TodoWrite tool calls */
  todos?: TodoItem[] | null;
  /** Current permission mode (session agents only) */
  permissionMode?: "acceptEdits" | "plan";
  /** Called when user toggles permission mode */
  onPermissionModeToggle?: () => void;
  /** Pending plan approval from ExitPlanMode tool call */
  pendingPlanApproval?: { allowedPrompts?: Array<{ tool: string; prompt: string }> } | null;
  /** Called when user approves the plan */
  onPlanApprove?: () => void;
  /** Called when user requests changes to the plan */
  onPlanRequestChanges?: (feedback: string) => void;
  /** Context usage data for this session */
  contextUsage?: ContextUsageState | null;
  /** Current model ID for the session (used for inline model switcher) */
  currentModelId?: string;
  /** Called when the user changes the model via the inline switcher */
  onModelChange?: (modelId: string) => void;
  /** Feature ID for file mention and slash command support in the prompt bar */
  featureId?: number;
  /** Project ID for slash command support in the prompt bar */
  projectId?: number;
  /** Active subprocess ID for slash command support in the prompt bar */
  subprocessId?: string;
  /** Pending tool permission request from canUseTool callback */
  pendingPermission?: PendingPermission | null;
  /** Called when user makes a permission decision */
  onPermissionDecision?: (decision: "allow_once" | "allow_future" | "deny", feedback?: string) => void;
  /** Whether this agent is maximized (takes full height, hides others) */
  maximized?: boolean;
  /** Called when user clicks maximize/minimize */
  onToggleMaximize?: () => void;
}

/** Handle exposed by AgentSession via forwardRef */
export interface AgentSessionHandle {
  /** Focus the prompt bar textarea */
  focusPromptBar: () => void;
  /**
   * Focus the most relevant interactive element in priority order:
   * 1. Permission prompt first button (if pending)
   * 2. Prompt bar / question drawer
   * 3. Header (fallback)
   */
  focusActiveInput: () => void;
  /** Whether the collapsible panel is currently open */
  isOpen: boolean;
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
  navAgentIndex,
  hasFileChanges,
  onViewDiff,
  canDelete,
  onDelete,
  todos,
  permissionMode,
  onPermissionModeToggle,
  pendingPlanApproval,
  onPlanApprove,
  onPlanRequestChanges,
  contextUsage,
  currentModelId,
  onModelChange,
  featureId,
  projectId,
  subprocessId,
  pendingPermission,
  onPermissionDecision,
  maximized,
  onToggleMaximize,
}, ref) {
  const promptBarRef = useRef<AgentPromptBarHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [promptBarFocused, setPromptBarFocused] = useState(false);
  const availableModels = trpc.settings.getAvailableModels.useQuery();
  const models = useMemo(() => availableModels.data ?? [], [availableModels.data]);

  // Auto-scroll: only scroll to bottom when the prompt bar is focused
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (promptBarFocused && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [promptBarFocused, blocks.length]);

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

  const headerRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusPromptBar: () => {
      promptBarRef.current?.focusInput();
    },
    focusActiveInput: () => {
      const container = containerRef.current;

      // Priority 1: first button in permission prompt area
      const permBtn = container?.querySelector<HTMLElement>('[data-permission-area] button');
      if (permBtn) { permBtn.scrollIntoView({ block: "nearest" }); permBtn.focus(); return; }
      // Priority 2: first focusable element in the question/plan-approval area
      const questionEl = container?.querySelector<HTMLElement>('[data-question-area] button, [data-question-area] input');
      if (questionEl) { questionEl.scrollIntoView({ block: "nearest" }); questionEl.focus(); return; }
      // Priority 3: prompt bar textarea
      const textarea = container?.querySelector<HTMLTextAreaElement>('textarea');
      if (textarea) { textarea.scrollIntoView({ block: "nearest" }); textarea.focus(); return; }
      // Priority 4: header
      if (headerRef.current) { headerRef.current.scrollIntoView({ block: "nearest" }); headerRef.current.focus(); }
    },
    isOpen,
  }), [isOpen]);

  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalOpen((prev) => !prev);
    }
  };

  const handleCollapse = () => {
    handleToggle();
    requestAnimationFrame(() => {
      headerRef.current?.focus();
    });
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

  // ---- Todo list bar ----
  const todoBar = todos && todos.length > 0 ? <AgentTodoList todos={todos} /> : null;

  // ---- Inline model switcher ----
  const currentModelLabel = models.find((m) => m.id === currentModelId)?.label ?? currentModelId ?? "Model";

  const handleCycleModel = useCallback(() => {
    if (!onModelChange || models.length === 0) return;
    const idx = models.findIndex((m) => m.id === currentModelId);
    const next = models[(idx + 1) % models.length];
    onModelChange(next.id);
  }, [currentModelId, onModelChange, models]);

  const modelBar = onModelChange ? (
    <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {currentModelLabel}
            <ChevronDownIcon className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          {models.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onModelChange(m.id)}
              className="flex items-center justify-between gap-2 text-xs"
            >
              {m.label}
              {m.id === currentModelId && <CheckIcon className="size-3 text-green-400" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-[10px] text-muted-foreground/50">⌥⇧P</span>
    </div>
  ) : null;

  // ---- Permission prompt bar ----
  const permissionBar = pendingPermission && onPermissionDecision ? (
    <div data-permission-area>
      <ToolPermissionPrompt
        permission={pendingPermission}
        onDecision={onPermissionDecision}
        disableShortcuts={disableShortcuts}
      />
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
        <AgentStream blocks={blocks} isStreaming={status === "running"} />
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
      onCollapse={collapsible ? handleCollapse : undefined}
      permissionMode={permissionMode}
      onPermissionModeToggle={onPermissionModeToggle}
      pendingPlanApproval={pendingPlanApproval}
      onPlanApprove={onPlanApprove}
      onPlanRequestChanges={onPlanRequestChanges}
      onCycleModel={onModelChange ? handleCycleModel : undefined}
      featureId={featureId}
      projectId={projectId}
      subprocessId={subprocessId}
      onToggleMaximize={onToggleMaximize}
    />
  ) : null;

  // ===========================================================================
  // Full-screen mode (collapsible = false)
  // ===========================================================================
  if (!collapsible) {
    return (
      <div ref={containerRef} className={cn("flex h-full flex-col", className)}>
        {/* Scrollable agent output */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto p-4" style={{ overflowAnchor: "none" }}>
          {streamContent}
        </div>

        {/* Review verdict actions */}
        {reviewVerdictSection}

        {/* Inline diff trigger */}
        {diffBar}

        {/* Todo list */}
        {todoBar}

        {/* Model switcher */}
        {modelBar}

        {/* Permission prompt */}
        {permissionBar}

        {/* Prompt bar pinned at bottom */}
        {promptBar && (
          <div>
            {promptBar}
          </div>
        )}

        {/* Context usage bar */}
        <ContextUsageBar usage={contextUsage} />
      </div>
    );
  }

  // ===========================================================================
  // Collapsible mode (collapsible = true)
  // ===========================================================================
  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col rounded-lg border border-border bg-background",
        isOpen && "flex-1 min-h-0",
        !isOpen && "shrink-0",
        className,
      )}
      {...(navAgentIndex != null ? { "data-agent-container": navAgentIndex } : {})}
    >
      {/* Header -- clickable to toggle */}
      <div
        ref={headerRef}
        className="shrink-0 flex cursor-pointer items-center gap-2 px-3 py-2 outline-none hover:bg-muted/50"
        onClick={handleToggle}
        data-nav-item
        {...(navAgentIndex != null ? { "data-nav-agent-index": navAgentIndex } : {})}
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
        <div className="ml-auto flex items-center gap-1">
          {resumable && onResume && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
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
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2Icon className="size-3" />
              Remove
            </Button>
          )}
          {isOpen && onToggleMaximize && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMaximize();
              }}
              title={maximized ? "Minimize" : "Maximize"}
            >
              {maximized ? <Minimize2Icon className="size-3" /> : <Maximize2Icon className="size-3" />}
            </Button>
          )}
        </div>
      </div>

      {/* Collapsible content */}
      {isOpen && (
        <>
          <div ref={scrollContainerRef} className="flex-1 min-h-0 border-t border-border overflow-y-auto" style={{ overflowAnchor: "none" }}>
            {/* Stream content */}
            {blocks.length === 0 && status === "idle" ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                No output yet
              </div>
            ) : (
              <AgentStream blocks={blocks} isStreaming={status === "running"} />
            )}
          </div>

          {/* Bottom section — pinned below scroll area */}
          <div className="shrink-0">
            {/* Review verdict actions */}
            {reviewVerdictSection}

            {/* Inline diff trigger */}
            {diffBar}

            {/* Todo list */}
            {todoBar}

            {/* Model switcher */}
            {modelBar}

            {/* Permission prompt */}
            {permissionBar}

            {/* Prompt bar */}
            {promptBar && (
              <div className="border-t border-border">
                {promptBar}
              </div>
            )}

            {/* Context usage bar */}
            <ContextUsageBar usage={contextUsage} />
          </div>
        </>
      )}
    </div>
  );
});
