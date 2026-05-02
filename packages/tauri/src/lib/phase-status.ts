import { CircleIcon, Loader2, CheckCircle2, XCircle, PencilLine } from "lucide-react";

interface PhaseStatusConfig {
  icon: React.ElementType;
  className: string;
  badgeClassName: string;
  label: string;
}

export const PHASE_STATUS_CONFIG: Record<string, PhaseStatusConfig> = {
  draft: {
    icon: PencilLine,
    className: "text-[var(--acc-purple)]",
    badgeClassName: "bg-[var(--acc-purple)]/20 text-[var(--acc-purple)]",
    label: "Draft",
  },
  pending: {
    icon: CircleIcon,
    className: "text-muted-foreground",
    badgeClassName: "bg-muted text-foreground",
    label: "Pending",
  },
  running: {
    icon: Loader2,
    className: "text-[var(--acc-orange)] animate-spin",
    badgeClassName: "bg-[var(--acc-orange)]/20 text-[var(--acc-orange)]",
    label: "Running",
  },
  completed: {
    icon: CheckCircle2,
    className: "text-[var(--acc-green)]",
    badgeClassName: "bg-[var(--acc-green)]/20 text-[var(--acc-green)]",
    label: "Completed",
  },
  done: {
    icon: CheckCircle2,
    className: "text-[var(--acc-green)]",
    badgeClassName: "bg-[var(--acc-green)]/20 text-[var(--acc-green)]",
    label: "Done",
  },
  error: {
    icon: XCircle,
    className: "text-[var(--acc-red)]",
    badgeClassName: "bg-[var(--acc-red)]/20 text-[var(--acc-red)]",
    label: "Error",
  },
};
