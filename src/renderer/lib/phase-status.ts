import { CircleIcon, Loader2, CheckCircle2, XCircle, PencilLine } from "lucide-react";

export interface PhaseStatusConfig {
  icon: React.ElementType;
  className: string;
  badgeClassName: string;
  label: string;
}

export const PHASE_STATUS_CONFIG: Record<string, PhaseStatusConfig> = {
  draft: { icon: PencilLine, className: "text-[var(--drac-purple)]", badgeClassName: "bg-[var(--drac-purple)]/20 text-[var(--drac-purple)]", label: "Draft" },
  pending: { icon: CircleIcon, className: "text-muted-foreground", badgeClassName: "bg-muted text-foreground", label: "Pending" },
  running: { icon: Loader2, className: "text-[var(--drac-orange)] animate-spin", badgeClassName: "bg-[var(--drac-orange)]/20 text-[var(--drac-orange)]", label: "Running" },
  completed: { icon: CheckCircle2, className: "text-[var(--drac-green)]", badgeClassName: "bg-[var(--drac-green)]/20 text-[var(--drac-green)]", label: "Completed" },
  done: { icon: CheckCircle2, className: "text-[var(--drac-green)]", badgeClassName: "bg-[var(--drac-green)]/20 text-[var(--drac-green)]", label: "Done" },
  error: { icon: XCircle, className: "text-[var(--drac-red)]", badgeClassName: "bg-[var(--drac-red)]/20 text-[var(--drac-red)]", label: "Error" },
};
