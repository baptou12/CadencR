import { Loader2Icon, CheckCircleIcon, XCircleIcon, PauseCircleIcon } from "lucide-react";
import type { AgentType } from "../../types/agent-types";

export type { AgentStatus } from "@/types/agent";
import type { AgentStatus } from "@/types/agent";

export const AGENT_LABELS: Partial<Record<AgentType, string>> = {
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

export const STATUS_BADGE: Record<
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
