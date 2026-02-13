import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { createElement } from "react";
import { Loader2Icon, CheckCircleIcon, XCircleIcon, RotateCcwIcon, ChevronRightIcon, PauseCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentStream } from "./AgentStream";
import { AgentPromptBar } from "./AgentPromptBar";
import type { AgentBlockData } from "./AgentBlock";
import type { AgentType } from "../../main/agents/types";
import type { AgentQuestion } from "./AgentQuestionDrawer";
import { AGENT_ICONS } from "./agent-icons";

export type AgentStatus = "idle" | "running" | "complete" | "error" | "paused";

interface AgentPanelProps {
  agentType: AgentType;
  /** Override the default label (e.g. "Execute 1" for parallel phases) */
  label?: string;
  status: AgentStatus;
  blocks: AgentBlockData[];
  className?: string;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onQuestionResponse?: (response: string) => void;
  /** Whether to show a "resumable" indicator */
  resumable?: boolean;
  /** Called when user clicks resume */
  onResume?: () => void;
  /** Called when user sends a message via the prompt bar */
  onSend?: (message: string) => void;
  /** Called when user clicks the stop button in the prompt bar */
  onStop?: () => void;
  /** Whether the panel content is expanded */
  open?: boolean;
  /** Called when the user toggles the panel */
  onToggle?: () => void;
}

export const AGENT_LABELS: Record<AgentType, string> = {
  plan: "Plan",
  brainstorm: "Brainstorm",
  execute: "Execute",
  risk: "Risk Analysis",
  review: "Review",
};

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
  complete: {
    label: "Complete",
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

export function AgentPanel({
  agentType,
  label,
  status,
  blocks,
  className,
  pendingQuestions,
  onQuestionResponse,
  resumable,
  onResume,
  onSend,
  onStop,
  open: controlledOpen,
  onToggle,
}: AgentPanelProps) {
  const badge = STATUS_BADGE[status];

  // If open/onToggle not provided, manage internally
  const [internalOpen, setInternalOpen] = useState(true);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  // Auto-open when agent starts running
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

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-background overflow-hidden",
        className
      )}
    >
      {/* Header — clickable to toggle */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/50"
        onClick={handleToggle}
      >
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-90"
          )}
        />
        {createElement(AGENT_ICONS[agentType], { className: "size-4 text-muted-foreground" })}
        <span className="text-sm font-medium">{label ?? AGENT_LABELS[agentType]}</span>
        <Badge variant="secondary" className={cn("gap-1 text-xs", badge.className)}>
          {badge.icon}
          {badge.label}
        </Badge>
        {resumable && onResume && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); onResume(); }}
          >
            <RotateCcwIcon className="size-3" />
            Resume
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
              <AgentStream blocks={blocks} isStreaming={status === "running"} />
            )}
          </div>

          {/* Prompt bar — shown when agent has output, is running, or has pending questions.
             Hidden for one-shot agents (plan, brainstorm) once they complete. */}
          {onSend && onStop && (status !== "idle" || blocks.length > 0 || (pendingQuestions && pendingQuestions.length > 0)) &&
           !((agentType === "plan" || agentType === "brainstorm") && status === "complete") && (
            <div className="border-t border-border">
              <AgentPromptBar
                onSend={onSend}
                onStop={onStop}
                status={status}
                pendingQuestions={pendingQuestions}
                onQuestionResponse={onQuestionResponse}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
