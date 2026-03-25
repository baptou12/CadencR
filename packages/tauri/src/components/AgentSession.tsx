/**
 * Unified agent UI component for all agent types.
 *
 * When `collapsible` is true, renders with a header and toggle (for workflow
 * view where multiple agents show).  When false, renders full-screen (for
 * standalone session view).
 *
 * Integrates AgentQuestionDrawer (shown when pendingQuestions is non-empty).
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
  Zap,
  ClipboardList,
} from "lucide-react";
import { KbdShortcut } from "./KbdShortcut";
import { AgentStream } from "./AgentStream";
import { AgentPromptBar, type AgentPromptBarHandle } from "./AgentPromptBar";
import { AgentTodoList } from "./AgentTodoList";
import { ContextUsageBar } from "./ContextUsageBar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { AgentBlockData } from "./AgentBlock";
import type { AgentType } from "../types/agent-types";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import type { TodoItem } from "@/types/agent";
import type { ContextUsageState } from "@/types/agent";
import type { PendingPermission } from "./ToolPermissionPrompt";
import { AGENT_ICONS } from "./agent-icons";
import { useGetFeatureWorkingDir, useListModels } from "../api/generated";

// ---------------------------------------------------------------------------
// Shared types & constants (previously in AgentPanel, now canonical here)
// ---------------------------------------------------------------------------

// Re-exported from @/types/agent to maintain backward compat
export type { AgentStatus } from "@/types/agent";
import type { AgentStatus } from "@/types/agent";

export const AGENT_LABELS: Record<AgentType, string> = {
  plan: "Plan",
  prd: "PRD",
  execute: "Execute",
  risk: "Risk Analysis",
  review: "Review",
  session: "Session",
  qa: "QA",
  "review-fixer": "Review Fixer",
  retro: "Retro",
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
  waiting: {
    label: "Waiting",
    className: "bg-blue-500/15 text-blue-300",
    icon: <PauseCircleIcon className="size-3" />,
  },
};

// ---------------------------------------------------------------------------
// SlidingText — shows full text on one line; slides back-and-forth if truncated
// ---------------------------------------------------------------------------

function SlidingText({ text, className }: { text: string; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const diff = inner.scrollWidth - outer.clientWidth;
      setOverflow(diff > 1 ? diff : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [text]);

  // Duration scales with overflow amount — roughly 1s per 50px
  const duration = Math.max(2, overflow / 50) * 2;

  return (
    <div ref={outerRef} className={cn("min-w-0 overflow-hidden", className)}>
      <span
        ref={innerRef}
        className="inline-block whitespace-nowrap"
        style={
          overflow > 0
            ? {
                animation: `slide-text ${duration}s ease-in-out infinite alternate`,
                ["--slide-distance" as string]: `-${overflow}px`,
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}

// Inject the keyframes once
if (typeof document !== "undefined" && !document.getElementById("slide-text-keyframes")) {
  const style = document.createElement("style");
  style.id = "slide-text-keyframes";
  style.textContent = `@keyframes slide-text { 0%, 15% { transform: translateX(0); } 85%, 100% { transform: translateX(var(--slide-distance)); } }`;
  document.head.appendChild(style);
}

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
  onSend: (message: string, images?: Array<{ base64: string; mimeType: string }>) => void;
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
  /** Label for the approve button */
  planApproveLabel?: string;
  /** Error from a failed plan approval attempt */
  planApprovalError?: string | null;
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
  /** Project ID for slash command support and prompt history in the prompt bar */
  projectId?: number;
  /** Agent session DB ID for draft persistence */
  sessionId?: number;
  /** Initial draft text (restored from DB) */
  initialDraft?: string | null;
  /** Active subprocess ID for slash command support in the prompt bar */
  subprocessId?: string;
  /** Pending tool permission request from canUseTool callback */
  pendingPermission?: PendingPermission | null;
  /** Called when user makes a permission decision */
  onPermissionDecision?: (decision: "allow_once" | "allow_future" | "deny", feedback?: string) => void;
  /** Called when user clicks "Mark Done" (session agents in workflow) */
  onMarkDone?: () => void;
  /** Whether this agent is maximized (takes full height, hides others) */
  maximized?: boolean;
  /** Called when user clicks maximize/minimize */
  onToggleMaximize?: () => void;
  /** Claude Code session ID to display above the prompt bar */
  claudeSessionId?: string;
  /** Override slash commands (bypasses tRPC fetch). Used by ws-session. */
  slashCommandsOverride?: import("@/hooks/useSlashCommand").SlashCommand[];
  /** Whether the override commands are still loading */
  slashCommandsLoading?: boolean;
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
  navAgentIndex,
  hasFileChanges,
  onViewDiff,
  canDelete,
  onDelete,
  todos,
  permissionMode,
  onPermissionModeToggle,
  pendingPlanApproval,
  planApproveLabel,
  planApprovalError,
  onPlanApprove,
  onPlanRequestChanges,
  contextUsage,
  currentModelId,
  onModelChange,
  featureId,
  projectId,
  sessionId,
  initialDraft,
  subprocessId,
  pendingPermission,
  onPermissionDecision,
  onMarkDone,
  maximized,
  onToggleMaximize,
  claudeSessionId,
  slashCommandsOverride,
  slashCommandsLoading,
}, ref) {
  const promptBarRef = useRef<AgentPromptBarHandle>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [promptBarFocused, setPromptBarFocused] = useState(false);
  const availableModels = useListModels();
  const models = useMemo(() => availableModels.data ?? [], [availableModels.data]);
  const cwdQuery = useGetFeatureWorkingDir(
    featureId ?? 0,
    projectId ?? 0,
    { enabled: featureId != null && projectId != null },
  );
  const projectPath = cwdQuery.data?.path ?? undefined;

  // ---- Collapsible state ----
  const [internalOpen, setInternalOpen] = useState(true);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  // Auto-scroll: enabled by default, disabled when user scrolls up,
  // re-enabled when the prompt bar is focused.
  const autoScrollRef = useRef(true);

  // Disable autoscroll when user scrolls up, re-enable when scrolled to bottom.
  // Re-attach when the collapsible panel toggles (scroll container remounts).
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      autoScrollRef.current = atBottom;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isOpen]);

  // Re-enable autoscroll when prompt bar is focused.
  useEffect(() => {
    if (promptBarFocused) {
      autoScrollRef.current = true;
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [promptBarFocused]);

  // Scroll to bottom on new content when autoscroll is active.
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (autoScrollRef.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [blocks]);

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
  const IconComponent = icon ?? AGENT_ICONS[agentType] ?? Loader2Icon;
  const displayLabel = label ?? AGENT_LABELS[agentType] ?? agentType;

  // Determine whether the prompt bar should be shown
  const shouldShowPromptBar = (() => {
    // Always show in non-collapsible (full-screen) mode unless totally idle with no blocks
    if (!collapsible) return true;

    // In collapsible mode:
    // Show when agent has output, is running, has pending questions, or pending plan approval.
    // Always show when there's a pending plan approval (e.g. plan/prd agents waiting for user to approve).
    if (pendingPlanApproval) return true;
    const hasOutput = blocks.length > 0;
    const hasQuestions = pendingQuestions && pendingQuestions.length > 0;
    return status !== "idle" || hasOutput || !!hasQuestions;
  })();

  // ---- Inline diff trigger ----
  const showDiffBar = hasFileChanges && onViewDiff;

  // ---- Inline model switcher ----
  const currentModelLabel = models.find((m) => m.id === currentModelId)?.label ?? currentModelId ?? "Model";

  const handleCycleModel = useCallback(() => {
    if (!onModelChange || models.length === 0) return;
    const idx = models.findIndex((m) => m.id === currentModelId);
    const next = models[(idx + 1) % models.length];
    onModelChange(next.id);
  }, [currentModelId, onModelChange, models]);

  // ---- Chip row (mode → model → review changes → tasks) ----
  const hasMeta =
    !!onPermissionModeToggle ||
    !!onModelChange ||
    showDiffBar ||
    (todos && todos.length > 0);

  const chipClass =
    "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors";

  const metaBar = hasMeta ? (
    <div
      className="relative -mt-6 flex items-center gap-1.5 px-3 py-3 backdrop-blur-sm"
      style={{
        background: "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.05) 10%, hsl(var(--background) / 0.12) 20%, hsl(var(--background) / 0.25) 35%, hsl(var(--background) / 0.45) 50%, hsl(var(--background) / 0.65) 65%, hsl(var(--background) / 0.82) 80%, hsl(var(--background) / 0.93) 90%, hsl(var(--background)) 100%)",
      }}
    >
      {/* Mode chip */}
      {onPermissionModeToggle && (
        <button
          type="button"
          onClick={onPermissionModeToggle}
          title="Toggle permission mode (Shift+Tab)"
          className={cn(
            chipClass,
            permissionMode === "plan"
              ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
              : "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25",
          )}
        >
          {permissionMode === "plan" ? (
            <ClipboardList className="size-3" />
          ) : (
            <Zap className="size-3" />
          )}
          {permissionMode === "plan" ? "Plan" : "Auto"}
          <KbdShortcut keys={["shift", "Tab"]} size="sm" />
        </button>
      )}

      {/* Model chip — violet */}
      {onModelChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(chipClass, "bg-violet-500/15 text-violet-400 hover:bg-violet-500/25")}
            >
              {currentModelLabel}
              <ChevronDownIcon className="size-3" />
              <KbdShortcut keys={["cmd", "P"]} size="sm" />
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
                {m.id === currentModelId && <CheckIcon className="size-3 text-violet-400" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Review Changes chip — orange */}
      {showDiffBar && (
        <button
          type="button"
          onClick={onViewDiff}
          className={cn(chipClass, "bg-orange-500/15 text-orange-400 hover:bg-orange-500/25")}
        >
          <FileEditIcon className="size-3" />
          Review Changes
          <KbdShortcut keys={["cmd", "D"]} size="sm" />
        </button>
      )}

      {/* Tasks chip — rose */}
      {todos && todos.length > 0 && <AgentTodoList todos={todos} chipClass={chipClass} />}
    </div>
  ) : null;

  // Permission is now rendered inside AgentPromptBar (replaces prompt input)

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
        <AgentStream blocks={blocks} isStreaming={status === "running"} basePath={projectPath} />
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
      planApproveLabel={planApproveLabel}
      planApprovalError={planApprovalError}
      onPlanApprove={onPlanApprove}
      onPlanRequestChanges={onPlanRequestChanges}
      onCycleModel={onModelChange ? handleCycleModel : undefined}
      featureId={featureId}
      projectId={projectId}
      sessionId={sessionId}
      initialDraft={initialDraft}
      onToggleMaximize={onToggleMaximize}
      noTopPadding={!!hasMeta}
      slashCommandsOverride={slashCommandsOverride}
      slashCommandsLoading={slashCommandsLoading}
      pendingPermission={pendingPermission}
      onPermissionDecision={onPermissionDecision}
    />
  ) : null;

  // ===========================================================================
  // Full-screen mode (collapsible = false)
  // ===========================================================================
  if (!collapsible) {
    return (
      <div ref={containerRef} className={cn("flex h-full flex-col", className)}>
        {/* Scrollable agent output */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto px-4 pt-4 pb-8" style={{ overflowAnchor: "none" }}>
          {streamContent}
        </div>

        {/* Bottom section */}
        <div className="shrink-0">
          {/* Meta toolbar: diff + todos + model */}
          {metaBar}

          {/* Session ID label */}
          {claudeSessionId && (
            <div className="flex justify-end px-3 pb-0.5">
              <span className="select-all font-mono text-[10px] text-muted-foreground/50">{claudeSessionId}</span>
            </div>
          )}

          {/* Prompt bar */}
          {promptBar}

          {contextUsage && (
            <div className="flex items-center gap-2 px-3 pb-1.5 pt-0">
              <ContextUsageBar usage={contextUsage} className="flex-1 px-0 py-0" />
            </div>
          )}
        </div>
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
        isOpen && maximized && "flex-1 min-h-0",
        isOpen && !maximized && "h-[60vh] min-h-0 shrink-0 overflow-hidden",
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
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-90",
          )}
        />
        {createElement(IconComponent, {
          className: "size-4 shrink-0 text-muted-foreground",
        })}
        <Badge
          variant="secondary"
          className={cn("shrink-0 gap-1 text-xs", badge.className)}
        >
          {badge.icon}
          {badge.label}
        </Badge>
        <SlidingText className="text-sm font-medium" text={displayLabel} />
        <div className="ml-auto flex items-center gap-1">
          {onMarkDone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-green-400"
              onClick={(e) => {
                e.stopPropagation();
                onMarkDone();
              }}
            >
              <CheckCircleIcon className="size-3" />
              Mark Done
            </Button>
          )}
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
                requestAnimationFrame(() => promptBarRef.current?.focusInput());
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
          <div ref={scrollContainerRef} className="flex-1 min-h-0 border-t border-border/30 overflow-y-auto pb-6" style={{ overflowAnchor: "none" }}>
            {/* Stream content */}
            {blocks.length === 0 && status === "idle" ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                No output yet
              </div>
            ) : (
              <AgentStream blocks={blocks} isStreaming={status === "running"} basePath={projectPath} />
            )}
          </div>

          {/* Bottom section — pinned below scroll area */}
          <div className="shrink-0">
            {/* Gradient + blur fade — overlaps last ~64px of scroll content.
               Skip when metaBar is visible since it already provides its own gradient + blur. */}
            {!hasMeta && (
              <div
                className="pointer-events-none h-16 -mt-16"
                style={{
                  background: "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.7) 8%, hsl(var(--background) / 0.9) 20%, hsl(var(--background)) 40%)",
                  backdropFilter: "blur(6px)",
                  WebkitBackdropFilter: "blur(6px)",
                  maskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
                  WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
                }}
              />
            )}

            {/* Meta toolbar: diff + todos + model */}
            {metaBar}

            {/* Prompt bar */}
            {promptBar}

            {contextUsage && (
              <div className="flex items-center gap-2 px-3 pb-1.5 pt-0">
                <ContextUsageBar usage={contextUsage} className="flex-1 px-0 py-0" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});
