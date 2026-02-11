import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2Icon, CheckCircleIcon, XCircleIcon } from "lucide-react";
import { AgentStream } from "./AgentStream";
import { AgentQuestionDrawer } from "./AgentQuestionDrawer";
import type { AgentBlockData } from "./AgentBlock";
import type { AgentType } from "../../main/agents/types";
import type { AgentQuestion } from "./AgentQuestionDrawer";

export type AgentStatus = "idle" | "running" | "complete" | "error";

interface AgentPanelProps {
  agentType: AgentType;
  status: AgentStatus;
  blocks: AgentBlockData[];
  className?: string;
  /** Active questions from AskUserQuestion tool calls */
  pendingQuestions?: AgentQuestion[];
  /** Called when the user submits a response to questions */
  onQuestionResponse?: (response: string) => void;
}

const AGENT_LABELS: Record<AgentType, string> = {
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
  idle: { label: "Idle", className: "bg-gray-500/15 text-gray-600 dark:text-gray-400" },
  running: {
    label: "Running",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
    icon: <Loader2Icon className="size-3 animate-spin" />,
  },
  complete: {
    label: "Complete",
    className: "bg-green-500/15 text-green-700 dark:text-green-300",
    icon: <CheckCircleIcon className="size-3" />,
  },
  error: {
    label: "Error",
    className: "bg-red-500/15 text-red-700 dark:text-red-300",
    icon: <XCircleIcon className="size-3" />,
  },
};

export function AgentPanel({
  agentType,
  status,
  blocks,
  className,
  pendingQuestions,
  onQuestionResponse,
}: AgentPanelProps) {
  const badge = STATUS_BADGE[status];

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-background overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{AGENT_LABELS[agentType]}</span>
        <Badge variant="secondary" className={cn("gap-1 text-xs", badge.className)}>
          {badge.icon}
          {badge.label}
        </Badge>
      </div>

      {/* Stream content */}
      {blocks.length === 0 && status === "idle" ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          No output yet
        </div>
      ) : (
        <AgentStream blocks={blocks} isStreaming={status === "running"} />
      )}

      {/* Question drawer — pushes content up from bottom */}
      <AgentQuestionDrawer
        questions={pendingQuestions ?? []}
        open={!!pendingQuestions && pendingQuestions.length > 0}
        onSubmit={onQuestionResponse ?? (() => {})}
      />
    </div>
  );
}
